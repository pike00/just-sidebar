import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Recipe, JustfileLocation } from './types.js';
import { parseJustList, shellQuote, MAX_RECIPES } from './justParser.js';

export { parseJustList, shellQuote } from './justParser.js';

const RECIPE_PREFIX = 'RECIPE:';
const LIST_TIMEOUT_MS = 10_000;

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Just Sidebar');
  }
  return outputChannel;
}

function log(msg: string): void {
  getOutputChannel().appendLine(`[just-sidebar] ${msg}`);
}

interface Config {
  justBinary: string;
  useNix: 'auto' | 'always' | 'never';
  terminalReuse: boolean;
}

function getConfig(): Config {
  const cfg = vscode.workspace.getConfiguration('justSidebar');
  return {
    justBinary: cfg.get<string>('justBinary', 'just'),
    useNix: cfg.get<'auto' | 'always' | 'never'>('useNix', 'auto'),
    terminalReuse: cfg.get<boolean>('terminalReuse', true),
  };
}

function resolveJustBinary(binary: string): string {
  if (binary.includes(path.sep) || binary.includes('/')) {
    if (!fs.existsSync(binary)) {
      log(`Warning: justBinary path does not exist: ${binary}`);
    }
  }
  return binary;
}

/**
 * Spawn just --list using array-args (no shell) and parse the output.
 * Uses cp.spawn so args are never interpolated into a shell string.
 */
export async function listRecipes(loc: JustfileLocation): Promise<Recipe[]> {
  const config = getConfig();
  const binary = resolveJustBinary(config.justBinary);
  const dir = path.dirname(loc.uri.fsPath);

  const args = [
    '--justfile', loc.uri.fsPath,
    '--working-directory', dir,
    '--list',
    '--unsorted',
    '--list-heading', '',
    '--list-prefix', RECIPE_PREFIX + ' ',
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = cp.spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
      log(`Timed out listing recipes from ${loc.uri.fsPath}`);
      resolve([]);
    }, LIST_TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0) {
        log(`just --list exited with code ${code} for ${loc.uri.fsPath}`);
        if (stderr) log(`stderr: ${stderr}`);
        resolve([]);
        return;
      }

      const recipes = parseJustList(stdout);

      if (recipes.length > MAX_RECIPES) {
        log(`Warning: ${loc.uri.fsPath} returned ${recipes.length} recipes (> ${MAX_RECIPES}). Truncating.`);
        vscode.window.showInformationMessage(
          `Just Sidebar: ${loc.relativePath} has too many recipes (${recipes.length}). Showing first ${MAX_RECIPES}.`
        );
        resolve(recipes.slice(0, MAX_RECIPES));
        return;
      }

      resolve(recipes);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (timedOut) return;
      log(`Failed to spawn just: ${err.message}`);
      resolve([]);
    });
  });
}

function hasFlakeNix(loc: JustfileLocation): boolean {
  const dir = path.dirname(loc.uri.fsPath);
  return fs.existsSync(path.join(dir, 'flake.nix'));
}

/** Build the shell command string to send to the terminal. */
export function buildRunCommand(
  recipe: Recipe,
  loc: JustfileLocation,
  extraArgs: string,
): string {
  const config = getConfig();
  const binary = resolveJustBinary(config.justBinary);

  const parts = [
    binary,
    '--justfile', shellQuote(loc.uri.fsPath),
    '--working-directory', shellQuote(path.dirname(loc.uri.fsPath)),
    recipe.name,
  ];

  // Treat extraArgs as a raw shell fragment — user's shell parses quotes/spaces
  if (extraArgs.trim()) {
    parts.push(extraArgs.trim());
  }

  const justCmd = parts.join(' ');

  const wrapNix =
    config.useNix === 'always' || (config.useNix === 'auto' && hasFlakeNix(loc));

  return wrapNix ? `nix develop --command ${justCmd}` : justCmd;
}

let sharedTerminal: vscode.Terminal | undefined;

function getTerminal(): vscode.Terminal {
  const config = getConfig();

  if (config.terminalReuse && sharedTerminal && !sharedTerminal.exitStatus) {
    return sharedTerminal;
  }

  const terminal = vscode.window.createTerminal('Just');
  if (config.terminalReuse) {
    sharedTerminal = terminal;
  }
  return terminal;
}

/** Run a recipe in the integrated terminal. */
export async function runRecipe(
  recipe: Recipe,
  loc: JustfileLocation,
  extraArgs = '',
): Promise<void> {
  const cmd = buildRunCommand(recipe, loc, extraArgs);
  const terminal = getTerminal();
  terminal.show(true);
  terminal.sendText(cmd);
}
