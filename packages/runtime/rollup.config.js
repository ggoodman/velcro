'use strict';

const { resolve } = require('path');

const RollupPluginNodeResolve = require('rollup-plugin-node-resolve');
const RollupPluginCommonJs = require('rollup-plugin-commonjs');
const RollupPluginTypescript = require('rollup-plugin-typescript2');
const { terser } = require('rollup-plugin-terser');
const Typescript = require('typescript');

const pkg = require('./package.json');

module.exports = [
  {
    input: resolve(__dirname, 'src/index.ts'),
    output: [
      {
        name: 'Velcro',
        extend: true,
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
  {
    input: resolve(__dirname, 'src/index.ts'),
    output: [
      {
        name: 'Velcro',
        extend: true,
        file: resolve(__dirname, pkg.browser).replace(/\.js$/, '.min.js'),
        format: 'umd',
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
      terser(),
    ],
  },
];
