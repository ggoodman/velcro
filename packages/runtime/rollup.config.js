const { resolve } = require('path');

const RollupPluginNodeResolve = require('rollup-plugin-node-resolve');
const RollupPluginCommonJs = require('rollup-plugin-commonjs');
const RollupPluginSucrase = require('rollup-plugin-sucrase');
const { terser } = require('rollup-plugin-terser');

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
      RollupPluginNodeResolve({
        extensions: ['.js', '.ts'],
      }),
      RollupPluginCommonJs(),
      RollupPluginSucrase({
        exclude: ['node_modules/**'],
        transforms: ['typescript'],
      }),
    ],
  },
  {
    input: resolve(__dirname, 'src/index.ts'),
    output: [
      {
        name: pkg.name.replace(/[^a-z]+/g, ' ').replace(/\s+[a-z]|^[a-z]/g, c => c[1].toUpperCase()),
        file: resolve(__dirname, pkg.browser).replace(/\.js$/, '.min.js'),
        format: 'umd',
      },
    ],
    plugins: [
      RollupPluginNodeResolve({
        extensions: ['.js', '.ts'],
      }),
      RollupPluginCommonJs(),
      RollupPluginSucrase({
        exclude: ['node_modules/**'],
        transforms: ['typescript'],
      }),
      terser(),
    ],
  },
];
