import * as vscode from 'vscode';
import { JustfileDiscovery } from './justfileDiscovery.js';
import { RecipeProvider, TreeNode } from './recipeProvider.js';
import { runRecipe } from './justRunner.js';
import { promptForArgs } from './argPrompt.js';

export function activate(ctx: vscode.ExtensionContext): void {
  const discovery = new JustfileDiscovery(ctx);
  const provider = new RecipeProvider(discovery);

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('justRecipes', provider),
    discovery,
  );

  // Set initial context key for multi-justfile menu visibility
  void discovery.findAll().then((list) => {
    void vscode.commands.executeCommand(
      'setContext',
      'justSidebar.multipleJustfiles',
      list.length > 1,
    );
  });

  // File watcher with 300ms debounce
  const watcher = vscode.workspace.createFileSystemWatcher('**/[Jj]ustfile');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleRefresh(): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      provider.refresh();
      void discovery.findAll().then((list) => {
        void vscode.commands.executeCommand(
          'setContext',
          'justSidebar.multipleJustfiles',
          list.length > 1,
        );
      });
    }, 300);
  }

  ctx.subscriptions.push(
    watcher,
    watcher.onDidChange(scheduleRefresh),
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
  );

  // Re-evaluate trust changes
  ctx.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => provider.refresh()),
  );

  // Config changes
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('justSidebar')) {
        provider.refresh();
      }
    }),
  );

  // Commands
  ctx.subscriptions.push(
    vscode.commands.registerCommand('justSidebar.refresh', () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand('justSidebar.runRecipe', async (node: TreeNode) => {
      if (!node || node.kind !== 'recipe') return;
      await runRecipe(node.recipe, node.loc);
    }),

    vscode.commands.registerCommand('justSidebar.runRecipeWithArgs', async (node: TreeNode) => {
      if (!node || node.kind !== 'recipe') return;
      const extraArgs = await promptForArgs(node.recipe);
      if (extraArgs === undefined) return; // user cancelled
      await runRecipe(node.recipe, node.loc, extraArgs);
    }),

    vscode.commands.registerCommand('justSidebar.runRecipeWithRawArgs', async (node: TreeNode) => {
      if (!node || node.kind !== 'recipe') return;
      const input = await vscode.window.showInputBox({
        title: `Run ${node.recipe.name} with raw args`,
        prompt: 'Raw argument fragment passed through to the shell after the recipe name',
        placeHolder: node.recipe.parameters.length > 0
          ? node.recipe.parameters.map((p) => (p.variadic ? `+${p.name}` : p.name)).join(' ')
          : 'e.g. --some-flag value',
        ignoreFocusOut: true,
      });
      if (input === undefined) return; // user cancelled
      await runRecipe(node.recipe, node.loc, input);
    }),

    vscode.commands.registerCommand('justSidebar.selectJustfile', async () => {
      await discovery.promptSelect();
    }),

    vscode.commands.registerCommand('justSidebar.openJustfile', async () => {
      const locations = await discovery.findAll();
      const active = discovery.getActive(locations);
      if (!active) {
        vscode.window.showInformationMessage('No justfile found in workspace.');
        return;
      }
      await vscode.window.showTextDocument(active.uri);
    }),

    vscode.commands.registerCommand('justSidebar.createJustfile', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('Open a folder before creating a justfile.');
        return;
      }

      const confirmed = await vscode.window.showInformationMessage(
        'Create a new justfile in the workspace root?',
        { modal: true },
        'Create',
      );
      if (confirmed !== 'Create') return;

      const root = folders[0].uri;
      const targetUri = vscode.Uri.joinPath(root, 'justfile');
      const content = Buffer.from(
        '# justfile\n\n# Example recipe\nhello:\n    echo "Hello, World!"\n',
        'utf8',
      );
      await vscode.workspace.fs.writeFile(targetUri, content);
      await vscode.window.showTextDocument(targetUri);
    }),
  );
}

export function deactivate(): void {
  // Disposables handled via ctx.subscriptions
}
