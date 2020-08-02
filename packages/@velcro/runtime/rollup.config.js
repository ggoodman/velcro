const Path = require('path');
const PackageJson = require('./package.json');
const RollupPluginTs = require('@wessberg/rollup-plugin-ts');
const RollupPluginTerser = require('rollup-plugin-terser').terser;

/** @type {import('rollup').RollupOptions[]} */
module.exports = [
  {
    input: Path.resolve(__dirname, './src/index.ts'),
    output: [
      {
        file: Path.resolve(__dirname, PackageJson.main),
        // format: 'iife',
        sourcemap: false,
        plugins: [
          {
            name: 'stringify',
            renderChunk(code) {
              return {
                code: `exports.runtime = ${JSON.stringify(`(function(Velcro){${code}})`)};`,
                map: '',
              };
            },
          },
        ],
      },
      {
        file: Path.resolve(__dirname, PackageJson.module),
        // format: 'iife',
        sourcemap: false,
        plugins: [
          {
            name: 'stringify',
            renderChunk(code) {
              console.log(code);
              return {
                code: `export const runtime = ${JSON.stringify(`(function(Velcro){${code}})`)};`,
                map: '',
              };
            },
          },
        ],
      },
    ],
    plugins: [RollupPluginTs(), RollupPluginTerser()],
  },
];
