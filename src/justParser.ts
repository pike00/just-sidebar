/**
 * Pure parsing functions with no VS Code dependency.
 * Import these in unit tests that run outside the VS Code host.
 */

import { Recipe, Parameter } from './types.js';

const RECIPE_PREFIX = 'RECIPE:';

// Parses: RECIPE: <name>[params...][# doc]
// Group headers from just look like: RECIPE: [group-name]
const RECIPE_LINE_RE = /^RECIPE:\s+(\S+)((?:\s+[^#]*)?)(?:#\s*(.*))?$/;
// Param kinds: +name, *name, name=default, name
const PARAM_RE = /^([+*]?)([^=]+)(?:=(.*))?$/;
// Group header: RECIPE: [group-name]  (name may contain spaces, shown as [name])
const GROUP_HEADER_RE = /^RECIPE:\s+\[([^\]]+)\]\s*$/;

export const MAX_RECIPES = 500;

/** Single-quote a string for POSIX shells. */
export function shellQuote(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function parseParam(token: string): Parameter {
  const m = PARAM_RE.exec(token);
  if (!m) return { name: token, variadic: false };
  const variadic = m[1] === '+' || m[1] === '*';
  const name = m[2].trim();
  const def = m[3] !== undefined ? m[3].trim() : undefined;
  return { name, default: def, variadic };
}

/** Parse lines emitted by just with a RECIPE: prefix. Assigns group names. */
export function parseJustList(output: string): Recipe[] {
  const recipes: Recipe[] = [];
  let currentGroup: string | undefined;

  for (const line of output.split('\n')) {
    if (!line.startsWith(RECIPE_PREFIX)) continue;

    // Detect group headers: RECIPE: [group-name]
    const groupMatch = GROUP_HEADER_RE.exec(line);
    if (groupMatch) {
      currentGroup = groupMatch[1];
      continue;
    }

    const m = RECIPE_LINE_RE.exec(line);
    if (!m) continue;

    const name = m[1];
    const paramStr = (m[2] || '').trim();
    const doc = m[3] ? m[3].trim() : undefined;

    const parameters: Parameter[] = paramStr
      ? paramStr.split(/\s+/).filter(Boolean).map(parseParam)
      : [];

    recipes.push({
      name,
      parameters,
      doc,
      isDefault: recipes.length === 0,
      group: currentGroup,
    });
  }

  return recipes;
}

/** Return true if any recipe in the list has a group assigned. */
export function hasGroups(recipes: Recipe[]): boolean {
  return recipes.some((r) => r.group !== undefined);
}

/** Group recipes by their group name; ungrouped recipes are under the key ''. */
export function groupRecipes(recipes: Recipe[]): Map<string, Recipe[]> {
  const map = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const key = r.group ?? '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}
