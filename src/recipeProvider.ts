import * as vscode from 'vscode';
import { JustfileDiscovery } from './justfileDiscovery.js';
import { listRecipes } from './justRunner.js';
import { Recipe, JustfileLocation } from './types.js';
import { hasGroups, groupRecipes } from './justParser.js';

export type TreeNode =
  | { kind: 'justfile'; loc: JustfileLocation; isActive: boolean }
  | { kind: 'group';    name: string; recipes: Recipe[]; loc: JustfileLocation }
  | { kind: 'recipe';   recipe: Recipe; loc: JustfileLocation };

export class RecipeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Cache: fsPath → recipes */
  private readonly cache = new Map<string, Recipe[]>();
  private locations: JustfileLocation[] = [];

  constructor(private readonly discovery: JustfileDiscovery) {
    discovery.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.cache.clear();
    this.locations = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'justfile': return this.justfileItem(node);
      case 'group':    return this.groupItem(node);
      case 'recipe':   return this.recipeItem(node);
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!vscode.workspace.isTrusted) return [];

    if (!element) return this.getRootChildren();

    if (element.kind === 'justfile') {
      return this.buildRecipeTree(element.loc, true);
    }

    if (element.kind === 'group') {
      return element.recipes.map((recipe) => ({ kind: 'recipe' as const, recipe, loc: element.loc }));
    }

    return [];
  }

  // -------------------------------------------------------------------------

  private async getRootChildren(): Promise<TreeNode[]> {
    if (this.locations.length === 0) {
      this.locations = await this.discovery.findAll();
    }
    if (this.locations.length === 0) return [];

    if (this.locations.length === 1) {
      return this.buildRecipeTree(this.locations[0], false);
    }

    const active = this.discovery.getActive(this.locations);
    return this.locations.map((loc) => ({
      kind: 'justfile' as const,
      loc,
      isActive: active?.uri.fsPath === loc.uri.fsPath,
    }));
  }

  /** Build the recipe/group nodes for a justfile. */
  private async buildRecipeTree(loc: JustfileLocation, isChild: boolean): Promise<TreeNode[]> {
    const recipes = await this.getCachedRecipes(loc);
    if (recipes.length === 0) return [];

    if (!hasGroups(recipes)) {
      // Flat list
      return recipes.map((recipe) => ({ kind: 'recipe' as const, recipe, loc }));
    }

    // Hierarchical: ungrouped first, then groups
    const byGroup = groupRecipes(recipes);
    const nodes: TreeNode[] = [];

    const ungrouped = byGroup.get('') ?? [];
    for (const recipe of ungrouped) {
      nodes.push({ kind: 'recipe', recipe, loc });
    }

    for (const [name, groupRecipeList] of byGroup) {
      if (name === '') continue;
      nodes.push({ kind: 'group', name, recipes: groupRecipeList, loc });
    }

    return nodes;
  }

  private async getCachedRecipes(loc: JustfileLocation): Promise<Recipe[]> {
    if (!this.cache.has(loc.uri.fsPath)) {
      const recipes = await listRecipes(loc);
      this.cache.set(loc.uri.fsPath, recipes);
    }
    return this.cache.get(loc.uri.fsPath) ?? [];
  }

  // -------------------------------------------------------------------------

  private justfileItem(node: { loc: JustfileLocation; isActive: boolean }): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.loc.relativePath,
      node.isActive
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.iconPath = new vscode.ThemeIcon('file');
    item.tooltip = node.loc.uri.fsPath;
    item.contextValue = 'justfile';
    return item;
  }

  private groupItem(node: { name: string; recipes: Recipe[] }): vscode.TreeItem {
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon('symbol-namespace');
    item.description = `${node.recipes.length} recipe${node.recipes.length === 1 ? '' : 's'}`;
    item.tooltip = node.name;
    item.contextValue = 'group';
    return item;
  }

  private recipeItem(node: { recipe: Recipe; loc: JustfileLocation }): vscode.TreeItem {
    const { recipe } = node;
    const item = new vscode.TreeItem(recipe.name, vscode.TreeItemCollapsibleState.None);

    if (recipe.parameters.length > 0) {
      item.description = recipe.parameters
        .map((p) => {
          const prefix = p.variadic ? '+' : '';
          return p.default !== undefined ? `${prefix}${p.name}=${p.default}` : `${prefix}${p.name}`;
        })
        .join(' ');
    }

    const lines: string[] = [];
    if (recipe.doc) lines.push(recipe.doc);
    if (recipe.parameters.length > 0) lines.push(`Parameters: ${item.description}`);
    if (recipe.isDefault) lines.push('(default recipe)');
    item.tooltip = lines.join('\n') || recipe.name;

    item.iconPath = new vscode.ThemeIcon('play');

    const hasParams = recipe.parameters.length > 0;
    item.contextValue = hasParams ? 'recipe-with-args' : 'recipe';

    item.command = {
      command: 'justSidebar.runRecipe',
      title: 'Run Recipe',
      arguments: [node],
    };

    return item;
  }
}
