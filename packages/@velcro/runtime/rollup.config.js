const Path = require('path');
const PackageJson = require('./package.json');
const RollupPluginTs = require('@wessberg/rollup-plugin-ts');
const RollupPluginTerser = require('rollup-plugin-terser').terser;
const { rollupConfigFactory } = require('../../../rollup.config.factory');

module.exports = [
  {
    input: Path.resolve(__dirname, './src/entry.ts'),
    output: {
      file: Path.resolve(__dirname, './src/code.ts'),
      sourcemap: false,
      plugins: [
        RollupPluginTerser(),
        {
          name: 'stringify',
          renderChunk(code) {
            return {
              code: `// This file is auto-generated. Do not edit.\n\nexport const runtime = ${JSON.stringify(
                `(function(Velcro){${code}})`
              )};`,
              map: '',
            };
          },
        },
      ],
    },
    plugins: [
      RollupPluginTs({
        tsconfig: {
          declaration: false,
        },
      }),
    ],
  },
  ...rollupConfigFactory(__dirname, PackageJson),
];
