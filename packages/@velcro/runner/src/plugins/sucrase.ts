import { Plugin } from '@velcro/bundler';
import { Options, transform } from 'sucrase';

export interface SucrasePluginOptions
  extends Partial<Pick<Options, 'jsxFragmentPragma' | 'jsxPragma' | 'transforms'>> {}

export function sucrasePlugin(options: SucrasePluginOptions = {}): Plugin {
  const extensions = ['js'];

  if (options.transforms) {
    for (const transform of options.transforms) {
      switch (transform) {
        case 'jsx':
          extensions.push('jsx');
          break;
        case 'typescript':
          extensions.push('ts', 'tsx');
          break;
      }
    }
  }

  const uriTestRx = new RegExp(`\.(?:${extensions.join('|')})$`, 'i');

  const jsxPragmaRx = /\/\*\*\s*@jsx\s+(\S+)\s*\*+\//;
  const jsxFragmentPragmaRx = /\/\*\*\s*@jsxFragment\s+(\S+)\s*\*+\//;

  return {
    name: 'sucrasePlugin',
    transform(ctx, uri, code) {
      if (!uriTestRx.test(uri.path)) {
        return;
      }

      const sucraseOptions: Options = {
        transforms: ['imports', ...(options.transforms || [])],
        filePath: uri.toString(),
        production: ctx.nodeEnv === 'production',
        sourceMapOptions: {
          compiledFilename: uri.toString(),
        },
      };

      if (!options.jsxPragma) {
        // If not specified try to detect the pragma
        const jsxPragmaMatches = code.match(jsxPragmaRx);
        if (jsxPragmaMatches) {
          sucraseOptions.jsxPragma = jsxPragmaMatches[1];
        }
      }

      if (!options.jsxFragmentPragma) {
        // If not specified try to detect the pragma
        const jsxFragmentPragmaMatches = code.match(jsxFragmentPragmaRx);
        if (jsxFragmentPragmaMatches) {
          sucraseOptions.jsxFragmentPragma = jsxFragmentPragmaMatches[1];
        }
      }

      const result = transform(code, sucraseOptions);

      return {
        code: result.code,
        sourceMap: result.sourceMap,
      };
    },
  };
}
