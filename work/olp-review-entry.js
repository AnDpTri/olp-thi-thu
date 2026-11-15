'use strict';
const vscode = require('vscode');
exports.review = async function (context, activate) {
  const root = vscode.workspace.workspaceFolders[0].uri;
  const kit = {
    id: 'review', title: 'Olympic Sinh viên 2024 - Khối Không chuyên',
    problems: [
      ['Đăng ký học phần', 'credit'],
      ['Đường đi', 'path'],
      ['Ba số nguyên tố', 'prime'],
      ['Đố vui', 'string']
    ].map(([name, code], index) => {
      const key = String.fromCharCode(65 + index);
      return { key, name: 'Olympic Sinh Viên 2024 - Không chuyên - ' + name,
        url: 'https://oj.vnoi.info/problem/olp_kc24_' + code, pdf: true, source: key + '.cpp', tests: 0 };
    })
  };
  const pdf = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'De-OLP-2024-Khong-chuyen.pdf'));
  for (const problem of kit.problems) {
    const dir = vscode.Uri.joinPath(root, 'OLP-review', problem.key);
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'De-bai.pdf'), pdf);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, problem.source), Buffer.from('// Bài A: Đăng ký học phần\n'));
  }
  await context.workspaceState.update('olp.practice.v1', { kit, sessions: [] });
  activate(context);
  await vscode.commands.executeCommand('olp.session.focus');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  if (process.env.OLP_PREVIEW_ONLY !== '1') await vscode.commands.executeCommand('olp.start');
  await vscode.commands.executeCommand('olp.source', 'A');
  await vscode.commands.executeCommand('olp.statement', { problem: kit.problems[0] });
  for (let retry = 0; retry < 15; retry++) {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    if (tabs.some(tab => tab.label === 'A · Đăng ký học phần')) break;
    if (retry === 14) throw new Error('Missing statement tab');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, 'review-ready'), Buffer.from('ready'));
};
