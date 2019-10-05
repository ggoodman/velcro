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
    input: resolve(__dirname, 'src/index.ts'),
    output: [
      {
        name: 'Velcro',
        extend: true,
        file: resolve(__dirname, pkg.browser),
        format: 'umd',
        sourcemap: true,
      },
    ],
    external: ['module'],
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
            sourceMap: true,
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
    external: [
      '@ampproject/remapping',
      '@velcro/resolver',
      'acorn',
      'js-base64',
      'magic-string',
      'module',
      'ts-primitives',
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
            sourceMap: true,
          },
          exclude: ['./test'],
        },
        objectHashIgnoreUnknownHack: true,
      }),
      // RollupPluginVisualizer({
      //   open: true,
      //   // sour÷cemap: true,
      //   template: 'treemap',
      // }),
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
        sourcemap: true,
      },
    ],
    external: ['module'],
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
          sourceMap: true,
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
