import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import postcssUrl from 'postcss-url';
import copy from 'rollup-plugin-copy';
import postcss from 'rollup-plugin-postcss';

/** @type {import('rollup').RollupOptions} */
const config = {
  input: {
    index: './src/index.ts',
    'css.worker': 'monaco-editor/esm/vs/language/css/css.worker.js',
    'html.worker': 'monaco-editor/esm/vs/language/html/html.worker.js',
    'json.worker': 'monaco-editor/esm/vs/language/json/json.worker.js',
    'typescript.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker.js',
    'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker',
  },
  output: [
    {
      sourcemap: true,
      format: 'esm',
      dir: 'dist',
      entryFileNames: '[name].esm.js',
    },
    {
      sourcemap: true,
      format: 'cjs',
      dir: 'dist',
      entryFileNames: '[name].cjs.js',
    },
  ],
  context: 'self',
  plugins: [
    resolve(),
    typescript({ sourceMap: false }),
    postcss({
      extract: false,
      minimize: true,
      plugins: [postcssUrl({ url: 'inline' })],
    }),
    copy({
      targets: [{ src: 'src/monaco.api.d.ts', dest: 'dist', rename: 'index.d.ts' }],
    }),
  ],
};

export default config;
