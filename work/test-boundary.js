'use strict';

const assert = require('node:assert/strict');
const vscode = require('vscode');
const ui = {
  now: Date.parse('2026-11-14T07:00:00Z'), errors: [], warnings: [], statusMessages: [],
  clipboard: '', opened: [], inputs: [], picks: [], infos: [], warnReply: undefined, infoReply: undefined, errorReply: undefined
};
const { window, env } = vscode;
exports.ui = ui;
exports.now = () => ui.now;
const split = rest => {
  const options = typeof rest[0] === 'object' ? rest.shift() : undefined;
  return { options, buttons: rest };
};
exports.vscode = {
  ...vscode,
  window: {
    createStatusBarItem: window.createStatusBarItem,
    createTreeView: window.createTreeView,
    createWebviewPanel: window.createWebviewPanel,
    createOutputChannel: window.createOutputChannel,
    registerCustomEditorProvider: window.registerCustomEditorProvider,
    onDidChangeActiveTextEditor: window.onDidChangeActiveTextEditor,
    onDidChangeWindowState: window.onDidChangeWindowState,
    onDidChangeTextEditorSelection: window.onDidChangeTextEditorSelection,
    onDidChangeTextEditorVisibleRanges: window.onDidChangeTextEditorVisibleRanges,
    get state() { return window.state; },
    get tabGroups() { return window.tabGroups; },
    get activeTextEditor() { return window.activeTextEditor; },
    get visibleTextEditors() { return window.visibleTextEditors; },
    showTextDocument: window.showTextDocument,
    withProgress: window.withProgress,
    setStatusBarMessage(text) {
      ui.statusMessages.push(text);
      return { dispose() {} };
    },
    async showInputBox(options) {
      const value = ui.inputs.shift();
      assert.equal(await options.validateInput?.(value), undefined);
      return value;
    },
    async showQuickPick(items) {
      return ui.picks.shift()?.(await items);
    },
    async showWarningMessage(message, ...rest) {
      ui.warnings.push(message);
      const { options, buttons } = split(rest);
      if (options?.modal) return buttons[0];
      return ui.warnReply?.(message, ...buttons);
    },
    async showInformationMessage(message, ...rest) {
      ui.infos.push(message);
      const { options, buttons } = split(rest);
      if (options?.modal && buttons[0] === 'Chờ nhận đề') return buttons[0];
      return ui.infoReply?.(message, ...buttons);
    },
    async showErrorMessage(message, ...rest) {
      ui.errors.push(message);
      return ui.errorReply?.(message, ...split(rest).buttons);
    }
  },
  env: {
    remoteName: env.remoteName,
    clipboard: { async writeText(text) { ui.clipboard = text; }, async readText() { return ui.clipboard; } },
    async openExternal(uri) {
      ui.opened.push(uri.toString());
      if (process.env.OLP_TEST_REAL_PDF === '1' && uri.scheme === 'file') return env.openExternal(uri);
      return true;
    }
  }
};
