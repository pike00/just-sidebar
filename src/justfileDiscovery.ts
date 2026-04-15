import * as vscode from 'vscode';
import { JustfileLocation } from './types.js';

const ACTIVE_JUSTFILE_KEY = 'justSidebar.activeJustfile';

export class JustfileDiscovery {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async findAll(): Promise<JustfileLocation[]> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return [];

    const cfg = vscode.workspace.getConfiguration('justSidebar');
    const searchDepth = cfg.get<number>('searchDepth', 3);

    // Build a glob pattern that limits depth
    const depthGlob = buildDepthGlob(searchDepth);

    const uris = await vscode.workspace.findFiles(
      depthGlob,
      '**/node_modules/**',
      200,
    );

    const locations: JustfileLocation[] = [];

    for (const uri of uris) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) continue;
      const relativePath = vscode.workspace.asRelativePath(uri, folders.length > 1);
      locations.push({ uri, workspaceFolder: folder, relativePath });
    }

    // Sort by path for stable ordering
    locations.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
    return locations;
  }

  getActive(locations: JustfileLocation[]): JustfileLocation | undefined {
    if (locations.length === 0) return undefined;

    const stored = this.context.workspaceState.get<string>(ACTIVE_JUSTFILE_KEY);
    if (stored) {
      const match = locations.find((l) => l.uri.fsPath === stored);
      if (match) return match;
    }
    return locations[0];
  }

  async setActive(loc: JustfileLocation): Promise<void> {
    await this.context.workspaceState.update(ACTIVE_JUSTFILE_KEY, loc.uri.fsPath);
    this._onDidChange.fire();
  }

  /** Show a QuickPick so the user can choose a justfile. */
  async promptSelect(): Promise<void> {
    const locations = await this.findAll();
    if (locations.length === 0) {
      vscode.window.showInformationMessage('No justfiles found in workspace.');
      return;
    }

    const items = locations.map((l) => ({
      label: l.relativePath,
      description: l.workspaceFolder.name,
      location: l,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a justfile',
    });

    if (picked) {
      await this.setActive(picked.location);
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/**
 * Build a glob pattern that matches [Jj]ustfile at any depth up to `maxDepth`.
 * vscode.workspace.findFiles doesn't support {n} quantifiers so we approximate
 * by listing every level explicitly up to maxDepth.
 */
function buildDepthGlob(maxDepth: number): string {
  if (maxDepth <= 1) return '[Jj]ustfile';

  // Build: [Jj]ustfile, **/[Jj]ustfile (vscode findFiles uses minimatch-style globs)
  // We rely on the maxResults cap (200) to limit results in practice.
  // A depth-limiting glob like {,*/,*/*/}[Jj]ustfile works for small depths.
  const parts: string[] = [];
  for (let d = 0; d < maxDepth; d++) {
    parts.push('*/'.repeat(d) + '[Jj]ustfile');
  }
  return `{${parts.join(',')}}`;
}
