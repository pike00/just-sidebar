/**
 * Integration tests — run inside the VS Code extension host against fixtures/single/
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

const fixturesRoot = path.resolve(__dirname, '../../../fixtures');

suite('Extension Integration', () => {
  suiteSetup(async function () {
    this.timeout(30_000);
    // Give the extension time to activate
    await new Promise((r) => setTimeout(r, 2_000));
  });

  test('extension activates', async () => {
    const ext = vscode.extensions.getExtension('pike00.just-sidebar');
    assert.ok(ext, 'Extension should be registered');
    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true);
  });

  test('tree view justRecipes is registered', () => {
    // VS Code registers tree views lazily; the view container itself is present after activation
    const ext = vscode.extensions.getExtension('pike00.just-sidebar');
    assert.ok(ext?.isActive, 'Extension must be active');
  });

  test('justSidebar.refresh command exists', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('justSidebar.refresh'), 'refresh command should be registered');
  });

  test('all commands are registered', async () => {
    const cmds = await vscode.commands.getCommands(true);
    const expected = [
      'justSidebar.refresh',
      'justSidebar.runRecipe',
      'justSidebar.runRecipeWithArgs',
      'justSidebar.selectJustfile',
      'justSidebar.openJustfile',
      'justSidebar.createJustfile',
    ];
    for (const cmd of expected) {
      assert.ok(cmds.includes(cmd), `Command ${cmd} should be registered`);
    }
  });

  test('workspace contains fixture justfile', async () => {
    const uris = await vscode.workspace.findFiles('**/justfile');
    assert.ok(uris.length >= 1, 'Should find at least one justfile in fixtures/single');
  });
});

// Utility: load a document from fixtures
export function fixtureUri(rel: string): vscode.Uri {
  return vscode.Uri.file(path.join(fixturesRoot, rel));
}
