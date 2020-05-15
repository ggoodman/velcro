const RollupPluginCommonJs = require('@rollup/plugin-commonjs');
const RollupPluginJson = require('@rollup/plugin-json');
const RollupPluginNodeResolve = require('@rollup/plugin-node-resolve');
const RollupPluginReplace = require('@rollup/plugin-replace');
const RollupPluginSucrase = require('@rollup/plugin-sucrase');
const RollupPluginTs = require('@wessberg/rollup-plugin-ts');
const { createRequire } = require('module');
const { resolve } = require('path');
const RollupPluginInjectProcessEnv = require('rollup-plugin-inject-process-env');
const { terser } = require('rollup-plugin-terser');

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
 * @param {string} filename
 * @return {import('rollup').RollupOptions[]}
 */
function rollupConfigFactory(dirname, filename) {
  const relativeRequire = createRequire(resolve(dirname, filename));
  const PackageJson = relativeRequire('./package.json');

  // const velcroTypescriptModules = [
  //   'bundler',
  //   'common',
  //   'resolver',
  //   'runner',
  //   'strategy-cdn',
  //   'strategy-compound',
  //   'strategy-fs',
  //   'strategy-memory',
  // ];

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
      exclude: ['node_modules/**', '**/*.mjs'],
    });

  return [
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, PackageJson.main),
        format: 'commonjs',
        sourcemap: true,
      },
      external(id) {
        return PackageJson.dependencies && Object.hasOwnProperty.call(PackageJson.dependencies, id);
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        RollupPluginNodeResolve(),
        RollupPluginReplace({ __VERSION__: PackageJson.version }),
        createTypescriptPlugin(true),
        RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      ],
    },
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, PackageJson.module),
        format: 'esm',
        sourcemap: true,
      },

      external(id) {
        return PackageJson.dependencies && Object.hasOwnProperty.call(PackageJson.dependencies, id);
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        RollupPluginNodeResolve(),
        RollupPluginReplace({ __VERSION__: PackageJson.version }),
        createTypescriptPlugin(),
        RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      ],
    },
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, PackageJson.browser),
        format: 'commonjs',
        sourcemap: true,
      },
      external(id) {
        return PackageJson.dependencies && Object.hasOwnProperty.call(PackageJson.dependencies, id);
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        RollupPluginNodeResolve({ browser: true, mainFields: ['browser', 'module', 'main'] }),
        RollupPluginReplace({ __VERSION__: PackageJson.version }),
        createTypescriptPlugin(),
        RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      ],
    },
    {
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, PackageJson.unpkg),
        format: 'umd',
        name: PackageJson.name.replace(/^@velcro\/(.*)$/, (_match, name) => toUmdName(name)),
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
        RollupPluginReplace({ __VERSION__: PackageJson.version }),
        dirname.endsWith('runner')
          ? RollupPluginSucrase({
              transforms: ['typescript'],
            })
          : createTypescriptPlugin(),
        RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
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
