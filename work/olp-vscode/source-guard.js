'use strict';
const { readFile } = require('node:fs/promises');
async function capture(workspace, uri) {
  const document = workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  return document ? document.getText() : readFile(uri.fsPath, 'utf8');
}
async function verify(workspace, uri, expected) {
  const [editor, disk] = await Promise.all([capture(workspace, uri), readFile(uri.fsPath, 'utf8')]);
  if (editor !== expected || disk !== expected) throw new Error('Mã đã thay đổi hoặc chưa lưu đúng nội dung. Hãy chạy lại.');
}
module.exports = { capture, verify };
