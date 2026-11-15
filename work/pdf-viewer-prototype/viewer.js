import { GlobalWorkerOptions, getDocument } from './pdf.min.js';

const { pdf, worker, cmaps, fonts } = document.body.dataset;
const byId = id => document.getElementById(id);
const pageField = byId('page');
const paper = byId('paper');
const status = byId('status');
const state = acquireVsCodeApi();
const buttons = ['previous', 'next', 'smaller', 'larger', 'fit'].map(byId);
const nextPaper = document.createElement('canvas');
let book;
let page = 1;
let zoom;
let revision = 0;
let queue = Promise.resolve();

GlobalWorkerOptions.workerSrc = worker;

function draw() {
  const requested = ++revision;
  queue = queue.catch(() => {}).then(async () => {
    if (!book || requested !== revision) return;
    const selected = await book.getPage(page);
    const width = selected.getViewport({ scale: 1 }).width;
    const scale = zoom ?? Math.min(2, Math.max(.2, (document.documentElement.clientWidth - 34) / width));
    const viewport = selected.getViewport({ scale });
    const pixels = Math.min(2, window.devicePixelRatio);
    nextPaper.width = Math.ceil(viewport.width * pixels);
    nextPaper.height = Math.ceil(viewport.height * pixels);
    await selected.render({
      canvasContext: nextPaper.getContext('2d'), viewport,
      transform: [pixels, 0, 0, pixels, 0, 0]
    }).promise;
    if (requested !== revision) return;
    paper.width = nextPaper.width;
    paper.height = nextPaper.height;
    paper.style.width = Math.ceil(viewport.width) + 'px';
    paper.style.height = Math.ceil(viewport.height) + 'px';
    paper.getContext('2d').drawImage(nextPaper, 0, 0);
    status.textContent = '';
  }).catch(() => { status.textContent = 'Không hiển thị được trang PDF này.'; });
}

function go(number) {
  page = Math.max(1, Math.min(book.numPages, Number.isFinite(number) ? Math.trunc(number) : page));
  pageField.value = page;
  byId('previous').disabled = page === 1;
  byId('next').disabled = page === book.numPages;
  state.setState({ page });
  window.scrollTo(0, 0);
  draw();
}

async function open() {
  book = await getDocument({
    url: pdf, cMapUrl: cmaps, cMapPacked: true, standardFontDataUrl: fonts,
    isEvalSupported: false
  }).promise;
  byId('total').textContent = '/ ' + book.numPages;
  pageField.max = book.numPages;
  pageField.disabled = false;
  for (const button of buttons) button.disabled = false;
  byId('previous').onclick = () => go(page - 1);
  byId('next').onclick = () => go(page + 1);
  pageField.onchange = () => go(pageField.valueAsNumber);
  byId('fit').onclick = () => { zoom = undefined; draw(); };
  byId('smaller').onclick = () => adjustZoom(.85);
  byId('larger').onclick = () => adjustZoom(1.18);
  window.addEventListener('resize', () => { if (zoom === undefined) draw(); });
  go(state.getState()?.page ?? 1);
}

async function adjustZoom(factor) {
  const selected = await book.getPage(page);
  const baseWidth = selected.getViewport({ scale: 1 }).width;
  zoom = Math.max(.25, Math.min(3, (paper.clientWidth / baseWidth) * factor));
  draw();
}

open().catch(() => { status.textContent = 'Không đọc được tệp PDF này.'; });
