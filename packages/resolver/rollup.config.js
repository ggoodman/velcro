const { resolve } = require('path');

const RollupPluginNodeResolve = require('rollup-plugin-node-resolve');
const RollupPluginCommonJs = require('rollup-plugin-commonjs');
const RollupPluginTypescript = require('rollup-plugin-typescript2');
const Typescript = require('typescript');

const pkg = require('./package.json');

module.exports = [
  {
    input: resolve(__dirname, 'src/index.ts'),
    output: [
      {
        name: pkg.name.replace(/[^a-z]+/g, ' ').replace(/\s+[a-z]|^[a-z]/g, c => c[1].toUpperCase()),
        file: resolve(__dirname, pkg.browser),
        format: 'umd',
      },
      {
        file: resolve(__dirname, pkg.main),
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: resolve(__dirname, pkg.module),
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      RollupPluginTypescript({
        check: false,
        tsconfig: resolve(__dirname, './tsconfig.json'),
        typescript: Typescript,
        tsconfigOverride: {
          compilerOptions: {
            module: 'esnext',
          },
        },
      }),
      RollupPluginNodeResolve(),
      RollupPluginCommonJs(),
    ],
  },
];
