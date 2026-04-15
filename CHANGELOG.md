# Changelog

## [0.1.0] — Unreleased

### Added
- Sidebar tree view showing `just` recipes from the workspace
- Click-to-run: single click on a recipe runs it in the integrated terminal
- "Run with Args" command for recipes that take parameters
- Multi-justfile workspace support with persistent active-justfile selection
- File watcher: tree refreshes automatically when justfiles change (300ms debounce)
- Nix integration: `useNix` setting wraps `just` with `nix develop --command`
- Terminal reuse: optional shared "Just" terminal across runs
- Workspace Trust support: recipes not listed in untrusted workspaces
- Manual recipe limit (500) with user notification
- 10-second timeout on `just --list` to handle hanging processes
- Output channel "Just Sidebar" for diagnostic logs

### Manual smoke checklist
- [ ] Sidebar appears in Activity Bar after opening a folder with a justfile
- [ ] Recipes appear and clicking runs them in a "Just" terminal
- [ ] Doc comments shown as descriptions
- [ ] Recipes with parameters prompt for input
- [ ] Multi-justfile workspace shows selector and remembers choice across reload
- [ ] Drag view to secondary sidebar — placement persists
- [ ] Nix workspace runs through `nix develop --command`
