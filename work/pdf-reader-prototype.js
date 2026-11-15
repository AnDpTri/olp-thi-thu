'use strict';

const { randomBytes } = require('node:crypto');

function registerPdfReader(vscode, context) {
  const provider = {
    openCustomDocument(uri) {
      return { uri, dispose() {} };
    },
    resolveCustomEditor(document, panel) {
      const { webview } = panel;
      const directory = vscode.Uri.joinPath(document.uri, '..');
      const assets = vscode.Uri.joinPath(context.extensionUri, 'pdf');
      const uri = (...parts) => webview.asWebviewUri(vscode.Uri.joinPath(assets, ...parts)).toString();
      const nonce = randomBytes(16).toString('hex');
      webview.options = { enableScripts: true, localResourceRoots: [assets, directory] };
      panel.title = 'Đề · ' + directory.path.split('/').at(-1);
      webview.html = /* html */ `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource}; connect-src ${webview.cspSource}; worker-src blob:; font-src blob: data:; img-src blob: data:">
  <link rel="stylesheet" href="${uri('viewer.css')}">
  <title>Đọc đề OLP</title>
</head>
<body data-pdf="${webview.asWebviewUri(document.uri)}" data-worker="${uri('pdf.worker.min.js')}"
      data-cmaps="${uri('cmaps')}/" data-fonts="${uri('standard_fonts')}/">
  <nav aria-label="Điều khiển PDF">
    <button id="previous" disabled aria-label="Trang trước">‹</button>
    <label>Trang <input id="page" type="number" min="1" value="1" disabled></label>
    <span id="total"></span>
    <button id="next" disabled aria-label="Trang sau">›</button>
    <button id="smaller" disabled aria-label="Thu nhỏ">−</button>
    <button id="larger" disabled aria-label="Phóng to">+</button>
    <button id="fit" disabled>Vừa chiều rộng</button>
    <span id="status" role="status">Đang tải đề…</span>
  </nav>
  <main id="sheet"><canvas id="paper" aria-label="Trang đề thi"></canvas></main>
  <script type="module" nonce="${nonce}" src="${uri('viewer.js')}"></script>
</body>
</html>`;
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('olp.statementPdf', provider));
}

module.exports = { registerPdfReader };
