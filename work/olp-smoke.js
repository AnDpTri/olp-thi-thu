'use strict';

const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('olp-local.olp-practice');
  assert(extension);
  await extension.activate();
  const registered = await vscode.commands.getCommands();
  for (const command of extension.packageJSON.contributes.commands) {
    assert(registered.includes(command.command), command.command);
  }
};
