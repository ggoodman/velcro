const RollupPluginCommonJs = require('@rollup/plugin-commonjs');
const RollupPluginJson = require('@rollup/plugin-json');
const RollupPluginNodeResolve = require('@rollup/plugin-node-resolve').default;
const RollupPluginReplace = require('@rollup/plugin-replace');
const RollupPluginSucrase = require('@rollup/plugin-sucrase');
const RollupPluginTs = require('@wessberg/rollup-plugin-ts');
const { createRequire } = require('module');
const { resolve } = require('path');
const RollupPluginInjectProcessEnv = require('rollup-plugin-inject-process-env');
const { terser } = require('rollup-plugin-terser');
const Typescript = require('typescript');

function toUmdName(name) {
  let umdName = 'Velcro.';

  for (const segment of name.split(/[^a-z]/)) {
    umdName += segment.charAt(0).toUpperCase() + segment.slice(1);
  }

  return umdName;
}

/**
 * Create a generic rollup config for a given directory
 *
 * @param {string} dirname
 * @param {any} packageJson
 * @return {import('rollup').RollupOptions[]}
 */
function rollupConfigFactory(dirname, packageJson) {
  const createTypescriptPlugin = (emitDeclarations = false) =>
    RollupPluginTs({
      cwd: dirname,
      tsconfig: {
        fileName: resolve(dirname, './tsconfig.json'),
        hook: (config) => ({
          ...config,
          declaration: emitDeclarations,
          declarationMap: emitDeclarations,
        }),
      },
      transpileOnly: !emitDeclarations,
      typescript: Typescript,
      exclude: ['node_modules/**', '**/*.mjs'],
    });

  return [
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, packageJson.main),
        format: 'commonjs',
        sourcemap: true,
      },
      external(id) {
        return packageJson.dependencies && Object.hasOwnProperty.call(packageJson.dependencies, id);
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        RollupPluginNodeResolve(),
        RollupPluginReplace({ __VERSION__: packageJson.version }),
        createTypescriptPlugin(true),
        RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      ],
    },
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, packageJson.module),
        format: 'esm',
        sourcemap: true,
      },

      external(id) {
        return packageJson.dependencies && Object.hasOwnProperty.call(packageJson.dependencies, id);
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        RollupPluginNodeResolve(),
        RollupPluginReplace({ __VERSION__: packageJson.version }),
        createTypescriptPlugin(),
        // RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      ],
    },
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, packageJson.unpkg),
        format: 'umd',
        name: packageJson.name.replace(/^@velcro\/(.*)$/, (_match, name) => toUmdName(name)),
        sourcemap: true,
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        RollupPluginNodeResolve({
          mainFields: ['module', 'main'],
        }),
        RollupPluginCommonJs(),
        RollupPluginReplace({
          __VERSION__: process.env.npm_package_version || packageJson.version,
        }),
        dirname.endsWith('runner') || dirname.endsWith('nostalgie')
          ? RollupPluginSucrase({
              transforms: ['typescript'],
            })
          : createTypescriptPlugin(),
        // RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
        terser({
          mangle: {
            reserved: ['createRuntime', 'Module', 'Runtime'],
          },
        }),
      ],
    },
  ];
}

exports.rollupConfigFactory = rollupConfigFactory;
