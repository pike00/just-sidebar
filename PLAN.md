# Plan: `just-sidebar` VS Code Extension

## Goal
A VS Code extension that surfaces `just` recipes in a sidebar view (Activity Bar by default; user can drag to the secondary/right sidebar). Each recipe is clickable and runs in a terminal. Handles multiple justfiles per workspace, recipes with parameters, and nix-shell environments.

## Why this is its own extension
None of the existing extensions ship a real tree view. `ElijahLopez.just-recipe-runner` only registers a `TaskProvider`. We want a dedicated, persistent, click-to-run UI.

---

## Architecture overview

Four modules, each independently testable:

1. **`justfileDiscovery.ts`** — find justfiles in workspace, manage "active justfile" selection (persisted in `workspaceState`).
2. **`justRunner.ts`** — invoke the `just` binary, parse `--list` output into `Recipe` objects, build the shell command for execution.
3. **`recipeProvider.ts`** — `vscode.TreeDataProvider<TreeNode>` that renders justfiles + recipes; exposes a refresh method.
4. **`extension.ts`** — `activate()` glue: register provider, commands, file watcher, status bar item.

Single-file extensions become unmaintainable fast; the four-file split keeps each unit under ~200 LOC and gives the test suite real seams.

---

## Project layout

```
just-sidebar/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── .vscodeignore
├── .gitignore
├── README.md
├── CHANGELOG.md
├── LICENSE                       # MIT
├── images/
│   ├── icon.png                  # 128x128 marketplace icon
│   └── activity-bar.svg          # monochrome SVG for activity bar
├── src/
│   ├── extension.ts
│   ├── recipeProvider.ts
│   ├── justRunner.ts
│   ├── justfileDiscovery.ts
│   ├── types.ts                  # Recipe, JustfileLocation interfaces
│   └── test/
│       ├── runTest.ts
│       └── suite/
│           ├── index.ts
│           ├── parser.test.ts    # pure-function tests, no vscode env needed
│           └── extension.test.ts # integration: open fixture, assert tree
└── fixtures/
    ├── single/justfile           # 4 recipes, one with args, one with doc comment
    ├── multi/{api,web}/justfile  # nested justfiles
    └── nix/{flake.nix,justfile}
```

---

## `package.json` contributions

```jsonc
{
  "name": "just-sidebar",
  "displayName": "Just Sidebar",
  "publisher": "<TBD>",
  "version": "0.1.0",
  "engines": { "vscode": "^1.95.0" },
  "categories": ["Other"],
  "activationEvents": ["workspaceContains:**/[Jj]ustfile"],
  "main": "./out/extension.js",
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": "limited",
      "description": "Listing recipes runs `just --list` against the workspace's justfile."
    },
    "virtualWorkspaces": false
  },
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "just-sidebar",
        "title": "Just",
        "icon": "images/activity-bar.svg"
      }]
    },
    "views": {
      "just-sidebar": [{
        "id": "justRecipes",
        "name": "Recipes",
        "icon": "images/activity-bar.svg",
        "contextualTitle": "Just Recipes"
      }]
    },
    "viewsWelcome": [{
      "view": "justRecipes",
      "contents": "No justfile found in this workspace.\n[Create justfile](command:justSidebar.createJustfile)"
    }],
    "commands": [
      { "command": "justSidebar.refresh",         "title": "Refresh",        "icon": "$(refresh)",  "category": "Just" },
      { "command": "justSidebar.runRecipe",       "title": "Run Recipe",     "icon": "$(play)",     "category": "Just" },
      { "command": "justSidebar.runRecipeWithArgs","title": "Run with Args…","icon": "$(edit)",    "category": "Just" },
      { "command": "justSidebar.selectJustfile",  "title": "Select Justfile…","category": "Just" },
      { "command": "justSidebar.openJustfile",    "title": "Open Justfile",  "icon": "$(go-to-file)","category": "Just" },
      { "command": "justSidebar.createJustfile",  "title": "Create Justfile","category": "Just" }
    ],
    "menus": {
      "view/title": [
        { "command": "justSidebar.refresh",       "when": "view == justRecipes", "group": "navigation@1" },
        { "command": "justSidebar.openJustfile",  "when": "view == justRecipes", "group": "navigation@2" },
        { "command": "justSidebar.selectJustfile","when": "view == justRecipes && justSidebar.multipleJustfiles", "group": "navigation@3" }
      ],
      "view/item/context": [
        { "command": "justSidebar.runRecipe",        "when": "view == justRecipes && viewItem == recipe",          "group": "inline@1" },
        { "command": "justSidebar.runRecipeWithArgs","when": "view == justRecipes && viewItem == recipe-with-args","group": "inline@2" }
      ]
    },
    "configuration": {
      "title": "Just Sidebar",
      "properties": {
        "justSidebar.justBinary":     { "type": "string",  "default": "just", "description": "Path to the `just` binary." },
        "justSidebar.useNix":         { "type": "string",  "enum": ["auto","always","never"], "default": "auto", "description": "Run inside `nix develop` if a flake.nix is present." },
        "justSidebar.terminalReuse":  { "type": "boolean", "default": true,   "description": "Reuse a single 'Just' terminal across runs instead of creating a new one each time." },
        "justSidebar.searchDepth":    { "type": "number",  "default": 3,      "description": "Maximum directory depth to search for justfiles." }
      }
    }
  }
}
```

**Note on right-side placement.** VS Code does not let an extension force a view into the secondary (right) sidebar. The standard pattern is to contribute to the activity bar and rely on the user dragging the view to the right. Document this in the README — it's a one-time action and persists.

---

## File-by-file implementation

### `src/types.ts`
```ts
export interface Recipe {
  name: string;
  parameters: Parameter[];   // empty if none
  doc?: string;              // from # comment or [doc("...")]
  isDefault: boolean;        // first recipe in --list output
}
export interface Parameter {
  name: string;
  default?: string;
  variadic: boolean;
}
export interface JustfileLocation {
  uri: vscode.Uri;
  workspaceFolder: vscode.WorkspaceFolder;
  relativePath: string;      // for display
}
```

### `src/justfileDiscovery.ts`
Responsibilities:
- `findJustfiles(): Promise<JustfileLocation[]>` — uses `vscode.workspace.findFiles('**/[Jj]ustfile', '**/node_modules/**', maxResults)` capped by `searchDepth` config.
- `getActiveJustfile(context): JustfileLocation | undefined` — reads `workspaceState.get('justSidebar.activeJustfile')` (stores fsPath); falls back to first found.
- `setActiveJustfile(context, loc)` — writes to workspaceState, fires an `EventEmitter<void>` for the provider to listen to.
- `pickJustfile(locations): Promise<JustfileLocation | undefined>` — `window.showQuickPick` UI when user invokes select command.

### `src/justRunner.ts`
Responsibilities:
- `listRecipes(loc, config): Promise<Recipe[]>`
  - Spawns the `just` binary with args `["--justfile", loc.fsPath, "--working-directory", dir, "--list", "--unsorted", "--list-heading", "", "--list-prefix", "RECIPE:"]`.
  - The `RECIPE:` prefix is a parser anchor that won't appear in real recipe names; far more robust than counting whitespace.
  - Parse each line: `RECIPE: <name>[ <param>...] [# <doc>]`.
  - Use a regex like `/^RECIPE:\s+(\S+)((?:\s+[^#]+)?)(?:\s*#\s*(.*))?$/` and split params on whitespace.
  - Detect parameters: `name`, `name=default`, `+name` / `*name` (variadic). Build the `Parameter[]`.
  - **Use `child_process.execFile` (NOT the shell-invoking variant)** wrapped in a Promise. No string interpolation into a shell, ever. Args go through the array form.
  - Timeout after ~10s; return `[]` and log to OutputChannel on failure.
- `buildRunCommand(recipe, loc, config, args): string`
  - Returns the literal command to send to a terminal.
  - Quotes `args` with a tiny `shellQuote` helper (write 5 lines that wrap each arg in single quotes and escape embedded single quotes; no need for an npm dep).
  - If `useNix === 'always'` or (`auto` and `flake.nix` exists in same dir): prefix with `nix develop --command `.
- `runRecipe(recipe, loc, config, args): Promise<void>`
  - Get/create a `vscode.Terminal` named `Just`. If `terminalReuse` is false, create a new one each call.
  - `terminal.show(true)`, then `terminal.sendText(buildRunCommand(...))`.

**Why terminal, not Task:** clicking from a sidebar should feel snappy and visible. Tasks add a layer of indirection (and historically have been buggy with reuse). Terminal API is simpler and the output is right there.

### `src/recipeProvider.ts`
```ts
type TreeNode =
  | { kind: 'justfile'; loc: JustfileLocation; isActive: boolean }
  | { kind: 'recipe'; recipe: Recipe; loc: JustfileLocation };
```
- Implements `TreeDataProvider<TreeNode>`.
- `getChildren()`:
  - No element → if 1 justfile, return its recipes directly. If >1, return a `justfile` node per location and only expand the active one's recipes (or render all justfiles, expand active by default).
  - `justfile` element → list recipes via `listRecipes(loc)`.
- `getTreeItem()`:
  - `recipe` node: `label = recipe.name`, `description = recipe.parameters.map(...)`, `tooltip` = doc + signature, `iconPath = ThemeIcon('play')`, `contextValue = recipe.parameters.length ? 'recipe-with-args' : 'recipe'`, `command = { command: 'justSidebar.runRecipe', arguments: [node] }` so a single click runs.
  - `justfile` node: `label = relativePath`, `iconPath = ThemeIcon('file')`, `collapsibleState = Expanded` for active.
- Caches recipe lists per justfile fsPath; clears on `refresh()`.
- Owns an `EventEmitter<TreeNode | undefined>` for `onDidChangeTreeData`.

### `src/extension.ts`
```ts
export function activate(ctx: vscode.ExtensionContext) {
  const discovery = new JustfileDiscovery(ctx);
  const provider  = new RecipeProvider(discovery);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('justRecipes', provider),

    vscode.commands.registerCommand('justSidebar.refresh',          () => provider.refresh()),
    vscode.commands.registerCommand('justSidebar.runRecipe',        (node) => runRecipeCommand(node, false)),
    vscode.commands.registerCommand('justSidebar.runRecipeWithArgs',(node) => runRecipeCommand(node, true)),
    vscode.commands.registerCommand('justSidebar.selectJustfile',   () => discovery.promptSelect()),
    vscode.commands.registerCommand('justSidebar.openJustfile',     () => openActiveJustfile(discovery)),
    vscode.commands.registerCommand('justSidebar.createJustfile',   () => createJustfileFlow()),

    vscode.workspace.createFileSystemWatcher('**/[Jj]ustfile').onDidChange(() => provider.refresh()),
    // (also onDidCreate / onDidDelete → refresh + re-discover)

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('justSidebar')) provider.refresh();
    }),
  );

  // Set context key for menu visibility
  discovery.findAll().then(list =>
    vscode.commands.executeCommand('setContext', 'justSidebar.multipleJustfiles', list.length > 1));
}
```
`runRecipeCommand` handles the args prompt: if `withArgs`, show `vscode.window.showInputBox({ prompt: 'Arguments for \`${name}\`' })` and pass the result through to `runRecipe`.

---

## Testing strategy

**Unit tests (no VS Code host needed)** — run via plain `mocha src/test/suite/parser.test.ts`:
- `parseJustList()` cases:
  - empty output → `[]`
  - single recipe, no params, no doc
  - recipe with `name=default` param
  - recipe with `+args` variadic
  - recipe with doc comment
  - recipe whose doc contains a `#`
  - line with the literal text `RECIPE:` in a doc (regression for the prefix-parser anchor choice)
- `buildRunCommand()` cases:
  - plain recipe
  - recipe with args containing spaces and quotes (assert correct quoting)
  - nix `auto` mode with/without flake.nix
  - nix `always` / `never` overrides

**Integration tests** — `@vscode/test-electron` opens `fixtures/single/`:
- Tree view registers and exposes ≥4 items
- Running a recipe creates a terminal named `Just` and sends the expected text (use `vscode.window.onDidOpenTerminal` + a stub on the terminal — this is the awkward part; alternatively assert via `vscode.window.terminals` length)
- File watcher: write a new recipe to the fixture, assert tree refreshes (use a temp copy of the fixture so the test doesn't dirty the repo)

**Manual smoke checklist** in README/CHANGELOG:
- [ ] Sidebar appears in Activity Bar after opening a folder with a justfile
- [ ] Recipes appear and clicking runs them in a `Just` terminal
- [ ] Doc comments shown as descriptions
- [ ] Recipes with parameters prompt for input
- [ ] Multi-justfile workspace shows selector and remembers choice across reload
- [ ] Drag view to secondary sidebar — confirm placement persists
- [ ] Nix workspace runs through `nix develop --command`

---

## Security & robustness checklist (for the implementer to satisfy)

1. **Use `child_process.execFile` (the array-args, no-shell variant), not the shell-invoking form.** No string interpolation into a shell when invoking `just`.
2. **Quote arguments** before sending to the terminal in `buildRunCommand`. Write a tiny helper; don't `${userInput}` into the command string raw.
3. **Workspace Trust**: declare `capabilities.untrustedWorkspaces.supported = "limited"`. In limited mode, do NOT auto-list recipes; show a "Trust workspace to load recipes" empty-state message instead. Use `vscode.workspace.isTrusted` and `onDidGrantWorkspaceTrust`.
4. **Bound recipe list size** — refuse to render >500 recipes; log and show an info message. Defends against pathological/malicious justfiles.
5. **Timeout `just --list`** at 10s; kill the process if it hangs.
6. **Validate the configured `justBinary`** — if it contains a path separator, resolve and check it exists; otherwise let `execFile` do PATH lookup.
7. **No telemetry. No network. No file writes outside the workspace** (only the `createJustfile` command writes, and only after a confirmation).
8. **OutputChannel** for all errors (`Just Sidebar`); never use `showErrorMessage` for parser warnings — too noisy.

---

## Risks & open questions

1. **`just --list` output format is not a stable API.** The `--list-heading ""` + `--list-prefix "RECIPE:"` approach is the most robust workaround short of waiting for the (still-unstable) JSON dump. Pin the minimum `just` version in the README — these flags need ≥1.13. *Open question for the implementer:* check current `just` release notes and consider switching to `just --dump --dump-format json` if it's stable enough by implementation time. Use context7 to verify.
2. **Right-sidebar placement is user-driven.** VS Code's API does not allow forcing it. README must show a screenshot of the drag gesture.
3. **Recipe parameters with quotes** are fiddly. The args-prompt path should treat the input as a single shell-escaped string; *do not* try to split on whitespace if the user typed quotes. Recommend: pass the raw input through and let the user's shell parse it. Document this.
4. **Tree refresh on every keystroke is wasteful.** Debounce file-watcher events ~300ms.
5. **Marketplace publisher namespace** — needs to be created and named before first `vsce publish`. Out of scope for the implementer but worth flagging.

---

## Build sequence for the agent

1. `npm init`, install dev deps (`@types/vscode @types/node @types/mocha typescript eslint @vscode/test-electron @vscode/test-cli`). No runtime deps.
2. Scaffold `package.json` contributions per the spec above; run `vsce package --no-yarn` early to validate the manifest.
3. Implement `types.ts` → `justRunner.ts` (parser first) → unit tests for parser → `justfileDiscovery.ts` → `recipeProvider.ts` → `extension.ts`.
4. Add fixtures and integration tests last.
5. Manual smoke test against a real justfile (e.g. `~/Documents/Finance/plaid-sync/justfile`) before declaring done.
6. Write README with screenshots, the right-sidebar drag instructions, the `just` version requirement, and the Workspace Trust behavior.

---

## What NOT to do
- Don't reimplement `just`'s parser. Always shell out.
- Don't add a runtime npm dependency. The whole thing fits in stdlib + `vscode`.
- Don't register a `TaskProvider` — that's what the existing extensions already do, and the user explicitly wants a clickable view instead.
- Don't auto-execute recipes on activation, ever.
- Don't add telemetry.
- Don't try to support remote/virtual workspaces in v0.1 (`virtualWorkspaces: false` is intentional).
