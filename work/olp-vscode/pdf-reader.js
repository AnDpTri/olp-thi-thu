'use strict';

const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fork } = require('node:child_process');

const assets = path.join(__dirname, 'pdf');
const shortName = name => name.replace(/^Olympic Sinh Viên \d{4}\s*-\s*Không chuyên\s*-\s*/iu, '');
const compact = text => text.normalize('NFKD').toLowerCase().replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');

async function locateProblems(document, problems) {
  const names = new Map(problems.map(problem => [compact(shortName(problem.name)), problem.key]));
  const headings = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const rows = [];
    const text = await page.getTextContent();
    for (const item of text.items) {
      if (!item.str?.trim()) continue;
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const row = rows.find(entry => Math.abs(entry.y - y) < 2);
      if (row) row.items.push({ x, text: item.str });
      else rows.push({ y, items: [{ x, text: item.str }] });
    }
    for (const row of rows.sort((a, b) => a.y - b.y)) {
      const line = row.items.sort((a, b) => a.x - b.x).map(item => item.text).join('');
      const match = line.match(/^(?:bài|bai)\s*\d+\s*[.:]\s*(.+)$/iu);
      if (!match) continue;
      const title = compact(match[1]);
      const name = [...names.keys()].find(value => value.length && title.startsWith(value));
      if (!name) continue;
      headings.push({ key: names.get(name), number, top: Math.max(0, row.y - 22) });
    }
  }
  return headings;
}

async function renderStatement(file, problem, problems) {
  const { createCanvas } = require('@napi-rs/canvas');
  const { getDocument, GlobalWorkerOptions } = await import(pathToFileURL(path.join(assets, 'pdf.min.mjs')));
  GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(assets, 'pdf.worker.min.mjs')).href;
  const task = getDocument({
    data: new Uint8Array(await readFile(file)), isEvalSupported: false,
    cMapUrl: path.join(assets, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(assets, 'standard_fonts') + path.sep
  });
  try {
    const document = await task.promise;
    const headings = problem.pages || problem.pdfWarning ? [] : await locateProblems(document, problems);
    const index = headings.findIndex(item => item.key === problem.key);
    const first = headings[index];
    const next = index >= 0 ? headings[index + 1] : undefined;
    const lastPage = problem.pages?.end ?? next?.number ?? document.numPages;
    const images = [];
    for (let number = problem.pages?.start ?? first?.number ?? 1; number <= lastPage; number++) {
      const page = await document.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const top = problem.pages ? (number === problem.pages.start ? problem.pages.top ?? 0 : 0) : number === first?.number ? first.top : 0;
      const bottom = problem.pages ? (number === problem.pages.end ? problem.pages.bottom ?? original.height : original.height) : number === next?.number ? next.top : original.height;
      if (bottom - top < 35) continue;
      const scale = Math.min(2.5, 1600 / original.width, 2600 / original.height);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil((bottom - top) * scale));
      await page.render({
        canvasContext: canvas.getContext('2d'), viewport,
        transform: [1, 0, 0, 1, 0, -top * scale], background: '#ffffff'
      }).promise;
      const paper = trimMargins(canvas, createCanvas, scale);
      if (paper) images.push({ number, uri: paper.toDataURL('image/png') });
      page.cleanup();
    }
    if (!images.length) throw new Error('PDF không có trang hiển thị được.');
    return { images, shared: headings.length > 1 && !first };
  } finally {
    await task.destroy();
  }
}

function trimMargins(canvas, createCanvas, scale) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  let left = width;
  let right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      if (data[pixel] < 220 || data[pixel + 1] < 220 || data[pixel + 2] < 220) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
  }
  if (left > right) return undefined;
  const margin = Math.ceil(18 * scale);
  left = Math.max(0, Math.min(left - margin, Math.round(width * .10)));
  right = Math.min(width, Math.max(right + margin + 1, Math.round(width * .90)));
  const cropped = createCanvas(right - left, height);
  cropped.getContext('2d').drawImage(canvas, -left, 0);
  return cropped;
}

function renderInWorker(file, problem, problems) {
  return new Promise((resolve, reject) => {
    const worker = fork(__filename, [], {
      execArgv: [], windowsHide: true, serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OLP_PDF_WORKER: '1' }
    });
    const timeout = setTimeout(() => {
      worker.kill();
      reject(new Error('Đọc PDF quá thời gian cho phép.'));
    }, 30000);
    worker.once('message', message => {
      if (message.error) reject(new Error(message.error));
      else resolve(message.content);
    });
    worker.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error('Không đọc được PDF (mã ' + code + ').'));
    });
    worker.send({ file, problem, problems });
  });
}

if (require.main === module && process.send) {
  process.once('message', async ({ file, problem, problems }) => {
    let result;
    try {
      result = { content: await renderStatement(file, problem, problems) };
    } catch (error) {
      result = { error: error.message };
    }
    process.send(result, () => process.disconnect());
  });
}

async function renderCached(file,problem,problems) {
  if(problem.rendered&&problem.rendered.range===JSON.stringify(problem.pages)&&problem.rendered.images?.length)try{
    const images=[];for(const image of problem.rendered.images){if(!/^statement-pages\/page-\d+\.png$/.test(image.file))throw Error('Invalid cached page');images.push({number:image.number,uri:'data:image/png;base64,'+(await readFile(path.join(path.dirname(file),image.file))).toString('base64')});}return {images,shared:false};
  }catch{}
  return renderInWorker(file,problem,problems);
}
module.exports = { renderStatement: renderCached, renderDirect: renderStatement, shortName };
