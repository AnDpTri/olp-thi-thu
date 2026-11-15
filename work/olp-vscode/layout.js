'use strict';

// Lời giải bên trái, input trên output bên phải. Đề mở riêng toàn chiều rộng.
// Các nhóm được dùng lại giữa các bài.
const plans = {
  plain: {
    orientation: 0,
    groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.55 }, { size: 0.45 }] }]
  },

};
const columns = { plain: { solution: 1, input: 2, output: 3 } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeLayout(vscode) {
  const { window, commands, workspace } = vscode;
  let applied;
  let generation = 0;

  const tabUris = input => input instanceof vscode.TabInputText ? [input.uri]
    : input instanceof vscode.TabInputTextDiff ? [input.original, input.modified] : [];

  async function waitGroups(count) {
    for (let attempt = 0; attempt < 30 && window.tabGroups.all.length !== count; attempt++) await sleep(50);
  }

  // Mở các tệp của bài vào đúng nhóm, đóng tệp thừa của mọi bộ đề (isKit), kết thúc với con trỏ trong tệp lời giải.
  async function arrange({ isKit, solution, input, output, statement, force }) {
    const kind = 'plain';
    const where = columns[kind];
    if (force || applied !== kind || window.tabGroups.all.length !== Object.keys(where).length) {
      await commands.executeCommand('vscode.setEditorLayout', plans[kind]);
      applied = kind;
      await waitGroups(Object.keys(where).length);
    }
    const mine = ++generation;
    const wanted = [[solution, where.solution], [input, where.input], [output, where.output]];
    const open = (uri, viewColumn, preserveFocus) => window.showTextDocument(uri, { viewColumn, preserveFocus, preview: false });
    const isStale = (tab, group) => tab.input instanceof vscode.TabInputTextDiff ? tabUris(tab.input).some(isKit)
      : tab.input instanceof vscode.TabInputText && isKit(tab.input.uri) &&
        !wanted.some(([uri, column]) => group.viewColumn === column && uri.toString() === tab.input.uri.toString());
    // Đóng tệp thừa của mọi bộ đề. Nhóm sẽ trống thì để lại (VS Code sẽ xoá nhóm trống), trừ khi `all`.
    async function closeStale(all) {
      const stale = [];
      for (const group of window.tabGroups.all) {
        const old = group.tabs.filter(tab => isStale(tab, group));
        if (!all && old.length === group.tabs.length) continue;
        stale.push(...old);
      }
      for (const tab of stale.filter(item => item.isDirty)) {
        for (const uri of tabUris(tab.input)) await workspace.textDocuments.find(document => document.uri.toString() === uri.toString())?.save();
      }
      if (stale.length) await window.tabGroups.close(stale);
    }
    for (const [uri, column] of wanted) await open(uri, column, true);
    // Đề được dựng nền (vài giây); không chờ để lời giải, input và output dùng được ngay.
    const rendering = undefined; // Statements are opened explicitly in their own full-width view.
    await closeStale(false);
    if (rendering) {
      void Promise.resolve(rendering).finally(() => mine === generation && closeStale(true)).catch(() => {});
    } else {
      await closeStale(true);
    }
    await focusSolution(solution);
  }

  async function focusSolution(solution) {
    await window.showTextDocument(solution, { viewColumn: 1, preserveFocus: false, preview: false });
    // An active text document alone does not guarantee keyboard focus: a panel,
    // notification or the webview can still own it after an awaited command.
    await commands.executeCommand('workbench.action.focusActiveEditorGroup');
  }

  return { arrange, focusSolution, reset: () => { applied = undefined; }, plans, columns };
}

module.exports = { makeLayout, plans, columns };
