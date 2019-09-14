'use strict';

const { resolve } = require('path');

const RollupPluginNodeResolve = require('rollup-plugin-node-resolve');
const RollupPluginCommonJs = require('rollup-plugin-commonjs');
const RollupPluginJson = require('rollup-plugin-json');
const { terser } = require('rollup-plugin-terser');
const RollupPluginTypescript = require('rollup-plugin-typescript2');
// const RollupPluginVisualizer = require('rollup-plugin-visualizer');
const Typescript = require('typescript');

const pkg = require('./package.json');

module.exports = [
  {
    external: ['module'],
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
      RollupPluginJson(),
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
        objectHashIgnoreUnknownHack: true,
      }),
      RollupPluginNodeResolve(),
      RollupPluginCommonJs(),
      // RollupPluginVisualizer({
      //   open: true,
      //   // sour÷cemap: true,
      //   template: 'treemap',
      // }),
    ],
  },
  {
    external: ['module'],
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
      RollupPluginJson(),
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
      terser({
        mangle: {
          reserved: ['Velcro'],
        },
      }),
    ],
  },
];
