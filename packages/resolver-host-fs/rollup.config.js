'use strict';

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
        name: 'Velcro',
        extend: true,
        file: resolve(__dirname, pkg.browser),
        format: 'umd',
      },
    ],
    plugins: [
      RollupPluginTypescript({
        check: true,
        tsconfig: resolve(__dirname, './tsconfig.json'),
        typescript: Typescript,
        tsconfigOverride: {
          compilerOptions: {
            module: 'esnext',
            rootDir: './src',
          },
          exclude: ['./test'],
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
    external: Object.keys(pkg.dependencies),
    plugins: [
      RollupPluginTypescript({
        check: true,
        tsconfig: resolve(__dirname, './tsconfig.json'),
        typescript: Typescript,
        tsconfigOverride: {
          compilerOptions: {
            module: 'esnext',
            rootDir: './src',
          },
          exclude: ['./test'],
        },
      }),
    ],
  },
];
