'use strict';
const { writeFile } = require('node:fs/promises');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Write the actual bytes once. WorkspaceEdit normalizes inserted newlines to the
// old buffer EOL before setEndOfLine, causing two generated content changes.
async function writeOutput(workspace, uri, text, { write = writeFile, timeoutMs = 5000 } = {}) {
  await write(uri.fsPath, text);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const document = workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (!document || document.isClosed || document.getText() === text) return;
    // A real user edit during the run must never be reverted by the refresh.
    if (document.isDirty) return;
    if (Date.now() >= deadline) throw new Error('Đã ghi output.txt nhưng VS Code chưa tải lại nội dung. Hãy mở lại output.txt.');
    await sleep(25);
  }
}
module.exports = { writeOutput };
