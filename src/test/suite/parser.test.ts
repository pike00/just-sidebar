/**
 * Unit tests for parseJustList and buildRunCommand.
 * These run in plain Node (no VS Code host) via: npx ts-node with mocha.
 * In the integration test runner they compile to .js and run inside the VS Code host.
 */

import * as assert from 'assert';
import * as path from 'path';

// We import the compiled JS in the integration runner; ts-node resolves TS directly.
// Use a relative path that works after compilation.
import { parseJustList, shellQuote } from '../../justParser.js';
import { buildRunCommand } from '../../justRunner.js';
import { splitArgs } from '../../argPrompt.js';
import { Recipe, JustfileLocation } from '../../types.js';

// Minimal mock URI / Location for buildRunCommand tests
function makeLocation(fsPath: string): JustfileLocation {
  return {
    uri: {
      fsPath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workspaceFolder: {} as any,
    relativePath: path.basename(fsPath),
  };
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    name: 'build',
    parameters: [],
    isDefault: false,
    ...overrides,
  };
}

suite('parseJustList', () => {
  test('empty output → []', () => {
    assert.deepStrictEqual(parseJustList(''), []);
  });

  test('ignores lines without RECIPE: prefix', () => {
    const output = 'Available recipes:\n  build\n  test\n';
    assert.deepStrictEqual(parseJustList(output), []);
  });

  test('single recipe, no params, no doc', () => {
    const output = 'RECIPE: build\n';
    const result = parseJustList(output);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'build');
    assert.deepStrictEqual(result[0].parameters, []);
    assert.strictEqual(result[0].doc, undefined);
    assert.strictEqual(result[0].isDefault, true);
  });

  test('recipe with name=default param', () => {
    const output = 'RECIPE: deploy env=production\n';
    const result = parseJustList(output);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].parameters.length, 1);
    assert.strictEqual(result[0].parameters[0].name, 'env');
    assert.strictEqual(result[0].parameters[0].default, 'production');
    assert.strictEqual(result[0].parameters[0].variadic, false);
  });

  test('recipe with +args variadic', () => {
    const output = 'RECIPE: run +args\n';
    const result = parseJustList(output);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].parameters.length, 1);
    assert.strictEqual(result[0].parameters[0].name, 'args');
    assert.strictEqual(result[0].parameters[0].variadic, true);
  });

  test('recipe with *args variadic', () => {
    const output = 'RECIPE: test *flags\n';
    const result = parseJustList(output);
    assert.strictEqual(result[0].parameters[0].variadic, true);
    assert.strictEqual(result[0].parameters[0].name, 'flags');
  });

  test('recipe with doc comment', () => {
    const output = 'RECIPE: build # compile the project\n';
    const result = parseJustList(output);
    assert.strictEqual(result[0].doc, 'compile the project');
  });

  test('recipe whose doc contains a #', () => {
    const output = 'RECIPE: build # see README # section 2\n';
    const result = parseJustList(output);
    // Everything after the first # is the doc
    assert.ok(result[0].doc?.includes('README'));
  });

  test('first recipe is isDefault, subsequent are not', () => {
    const output = 'RECIPE: first\nRECIPE: second\nRECIPE: third\n';
    const result = parseJustList(output);
    assert.strictEqual(result[0].isDefault, true);
    assert.strictEqual(result[1].isDefault, false);
    assert.strictEqual(result[2].isDefault, false);
  });

  test('line with literal RECIPE: in a doc does not double-parse', () => {
    // The RECIPE: prefix must be at the start of the line
    const output = 'RECIPE: build # see RECIPE: section\nsome other line with RECIPE: inside\n';
    const result = parseJustList(output);
    // The second line doesn't start with RECIPE: so it's ignored
    assert.strictEqual(result.length, 1);
  });

  test('multiple params with defaults and variadics', () => {
    const output = 'RECIPE: deploy env=prod tag=latest +services\n';
    const result = parseJustList(output);
    const params = result[0].parameters;
    assert.strictEqual(params.length, 3);
    assert.strictEqual(params[0].name, 'env');
    assert.strictEqual(params[0].default, 'prod');
    assert.strictEqual(params[1].name, 'tag');
    assert.strictEqual(params[1].default, 'latest');
    assert.strictEqual(params[2].name, 'services');
    assert.strictEqual(params[2].variadic, true);
  });
});

suite('shellQuote', () => {
  test('plain string', () => {
    assert.strictEqual(shellQuote('hello'), "'hello'");
  });

  test('string with single quote', () => {
    assert.strictEqual(shellQuote("it's"), "'it'\\''s'");
  });

  test('string with spaces', () => {
    assert.strictEqual(shellQuote('hello world'), "'hello world'");
  });

  test('string with special chars', () => {
    assert.strictEqual(shellQuote('$HOME'), "'$HOME'");
  });
});

suite('buildRunCommand', () => {
  // buildRunCommand reads vscode.workspace.getConfiguration which isn't available
  // outside the VS Code host. We can't test it directly in plain Node, so these
  // tests run only in the integration runner (inside the VS Code host).
  //
  // See the integration section in extension.test.ts for terminal command assertions.

  test('placeholder — buildRunCommand tests run in integration suite', () => {
    // If we're here we're in the VS Code host; actual assertions are in extension.test.ts
    assert.ok(typeof buildRunCommand === 'function');
  });
});

suite('parseJustList edge cases', () => {
  test('recipe with no trailing newline', () => {
    const output = 'RECIPE: build';
    const result = parseJustList(output);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'build');
  });

  test('recipe with extra whitespace in params', () => {
    const output = 'RECIPE: test   verbose=false\n';
    const result = parseJustList(output);
    assert.strictEqual(result[0].parameters[0].name, 'verbose');
    assert.strictEqual(result[0].parameters[0].default, 'false');
  });
});

suite('splitArgs', () => {
  test('empty string → []', () => {
    assert.deepStrictEqual(splitArgs(''), []);
  });

  test('whitespace only → []', () => {
    assert.deepStrictEqual(splitArgs('   \t '), []);
  });

  test('simple space-separated', () => {
    assert.deepStrictEqual(splitArgs('foo bar baz'), ['foo', 'bar', 'baz']);
  });

  test('collapses runs of whitespace', () => {
    assert.deepStrictEqual(splitArgs('foo    bar\tbaz'), ['foo', 'bar', 'baz']);
  });

  test('double-quoted groups span spaces', () => {
    assert.deepStrictEqual(splitArgs('foo "bar baz" qux'), ['foo', 'bar baz', 'qux']);
  });

  test('single-quoted groups span spaces and preserve backslash', () => {
    assert.deepStrictEqual(splitArgs("a 'b\\c d' e"), ['a', 'b\\c d', 'e']);
  });

  test('backslash escapes a space outside quotes', () => {
    assert.deepStrictEqual(splitArgs('foo\\ bar baz'), ['foo bar', 'baz']);
  });

  test('backslash escapes a quote inside double quotes', () => {
    assert.deepStrictEqual(splitArgs('"she said \\"hi\\""'), ['she said "hi"']);
  });

  test('empty double-quoted string is kept', () => {
    assert.deepStrictEqual(splitArgs('foo "" bar'), ['foo', '', 'bar']);
  });

  test('adjacent quoted and unquoted chunks concatenate', () => {
    assert.deepStrictEqual(splitArgs('foo"bar baz"qux'), ['foobar bazqux']);
  });
});
