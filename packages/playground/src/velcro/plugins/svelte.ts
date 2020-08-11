import { execute } from '@velcro/runner';
import { version as svelteVersion } from 'svelte/package.json';

import { readUrl } from '../util';
import { Plugin } from '@velcro/bundler';

export function sveltePlugin(): Plugin {
  let svelteCompilerPromise: Promise<typeof import('svelte/compiler')> | undefined = undefined;

  const loadCompiler = () => {
    if (!svelteCompilerPromise) {
      svelteCompilerPromise = execute('module.exports = require("svelte/compiler")', {
        readUrl,
        cdn: 'jsdelivr',
        dependencies: {
          svelte: svelteVersion,
        },
        nodeEnv: 'production',
        // plugins: [sucrasePlugin()],
      });

      svelteCompilerPromise.catch((err) => {
        console.trace(err);
      });
    }

    return svelteCompilerPromise;
  };

  return {
    name: 'svelte',
    async transform(ctx, uri, code) {
      if (uri.fsPath.endsWith('.svelte')) {
        const compiler = await loadCompiler();
        const compilationResult = compiler.compile(code, {
          css: false,
          outputFilename: uri.toString(),
          format: 'cjs',
        });

        // The CommonJS produced by svelte dumps the component on `exports.default` but doesn't use the `__esModule`
        // interop hint. This is a little hack to work around that.
        code = `${compilationResult.js.code}; Object.defineProperty(module.exports, '__esModule', { value: true });`;

        return {
          code,
          sourceMap: compilationResult.js.map,
        };
      }
      return undefined;
    },
  };
}
