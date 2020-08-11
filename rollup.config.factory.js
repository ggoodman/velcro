const RollupPluginCommonJs = require('@rollup/plugin-commonjs');
const RollupPluginJson = require('@rollup/plugin-json');
const RollupPluginNodeResolve = require('@rollup/plugin-node-resolve').default;
const RollupPluginReplace = require('@rollup/plugin-replace');
const RollupPluginTs = require('@wessberg/rollup-plugin-ts');
const { resolve } = require('path');
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
exports.rollupConfigFactory = function rollupConfigFactory(dirname, packageJson) {
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
      transpiler: 'babel',
      typescript: Typescript,
      // exclude: ['node_modules/**', '**/*.mjs'],
    });

  /** @type {import('rollup').RollupOptions[]} */
  const configs = [];

  if (packageJson.main || packageJson.module) {
    /** @type {import('rollup').OutputOptions[]} */
    const output = [];

    if (packageJson.main) {
      output.push({
        file: resolve(dirname, packageJson.main),
        format: 'commonjs',
        sourcemap: true,
      });
    }

    if (packageJson.module) {
      output.push({
        file: resolve(dirname, packageJson.module),
        format: 'esm',
        sourcemap: true,
      });
    }

    configs.push({
      input: resolve(dirname, './src/index.ts'),
      output,
      external(id) {
        return Object.hasOwnProperty.call(
          { ...packageJson.dependencies, ...packageJson.devDependencies },
          id
        );
      },
      onwarn: (msg, warn) => {
        if (!/Circular/.test(msg)) {
          warn(msg);
        }
      },
      plugins: [
        RollupPluginJson(),
        createTypescriptPlugin(true),
        RollupPluginNodeResolve({
          mainFields: ['module', 'main', 'unpkg'],
        }),
        RollupPluginReplace({ __VERSION__: packageJson.version }),
      ],
    });
  }

  if (packageJson.unpkg) {
    configs.push({
      input: resolve(dirname, './src/index.ts'),
      output: {
        file: resolve(dirname, packageJson.unpkg),
        format: 'iife',
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
        createTypescriptPlugin(false),
        RollupPluginNodeResolve({
          mainFields: ['module', 'main', 'unpkg'],
        }),
        RollupPluginCommonJs(),
        RollupPluginReplace({
          __VERSION__: process.env.npm_package_version || packageJson.version,
        }),
        terser(),
      ],
    });
  }

  return configs;
};
