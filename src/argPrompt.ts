/**
 * Structured per-parameter prompting for recipes that take arguments.
 *
 * Replaces a single freeform input box with one prompt per Parameter,
 * assembles a shell-quoted argument fragment, and returns it (or
 * undefined if the user cancels at any step).
 */

import * as vscode from 'vscode';
import { Recipe, Parameter } from './types.js';
import { shellQuote } from './justParser.js';

/**
 * Split a user-entered string into individual arguments using shell-like
 * rules: whitespace separates, single quotes and double quotes group,
 * backslash escapes the next character (outside single quotes).
 * Exported for unit testing.
 */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let hasContent = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        cur += ch;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === '\\' && i + 1 < input.length) {
        cur += input[++i];
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasContent = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasContent = true;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i];
      hasContent = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (hasContent) {
        out.push(cur);
        cur = '';
        hasContent = false;
      }
      continue;
    }

    cur += ch;
    hasContent = true;
  }

  if (hasContent) out.push(cur);
  return out;
}

function describeParam(param: Parameter, index: number, total: number): string {
  const bits = [`${index + 1}/${total}`, param.name];
  if (param.variadic) {
    bits.push('(variadic)');
  } else if (param.default !== undefined) {
    bits.push(`(default: ${param.default})`);
  } else {
    bits.push('(required)');
  }
  return bits.join(' · ');
}

interface RawInput {
  param: Parameter;
  raw: string;
}

/**
 * Prompt the user for each parameter of a recipe sequentially, then
 * assemble a shell-quoted argument fragment suitable for passing to
 * runRecipe as its extraArgs string.
 *
 * Returns undefined if the user cancels at any step.
 */
export async function promptForArgs(recipe: Recipe): Promise<string | undefined> {
  if (recipe.parameters.length === 0) return '';

  const raws: RawInput[] = [];
  const total = recipe.parameters.length;

  for (let i = 0; i < total; i++) {
    const param = recipe.parameters[i];
    const required = !param.variadic && param.default === undefined;

    const placeHolder = param.variadic
      ? 'space-separated values — quote to group'
      : param.default !== undefined
        ? `leave empty to use default: ${param.default}`
        : param.name;

    const input = await vscode.window.showInputBox({
      title: `Run ${recipe.name}`,
      prompt: describeParam(param, i, total),
      placeHolder,
      ignoreFocusOut: true,
      validateInput: (val) => {
        if (required && val.trim() === '') return `${param.name} is required`;
        return undefined;
      },
    });

    if (input === undefined) return undefined; // user cancelled
    raws.push({ param, raw: input });
  }

  // Trim trailing entries where the user left the value empty and a
  // default (or variadic-empty) will apply. This keeps positional
  // semantics correct: we only omit from the tail.
  while (raws.length > 0) {
    const last = raws[raws.length - 1];
    const trimmed = last.raw.trim();
    if (trimmed !== '') break;
    if (last.param.variadic) {
      raws.pop();
      continue;
    }
    if (last.param.default !== undefined) {
      raws.pop();
      continue;
    }
    break; // required & empty — should not happen, validation blocks it
  }

  const pieces: string[] = [];
  for (const { param, raw } of raws) {
    const trimmed = raw.trim();
    if (param.variadic) {
      for (const part of splitArgs(trimmed)) {
        pieces.push(shellQuote(part));
      }
      continue;
    }
    // Non-variadic middle slot left empty → substitute literal default so
    // later positional args stay aligned. Niche case: defaults that
    // reference other just variables won't round-trip; user can edit.
    const value = trimmed === '' && param.default !== undefined ? param.default : trimmed;
    pieces.push(shellQuote(value));
  }

  return pieces.join(' ');
}
