import RollupPluginCommonJs from '@rollup/plugin-commonjs';
import RollupPluginJson from '@rollup/plugin-json';
import RollupPluginNodeResolve from '@rollup/plugin-node-resolve';
import RollupPluginReplace from '@rollup/plugin-replace';
import RollupPluginTs from '@wessberg/rollup-plugin-ts';
import { resolve } from 'path';
import RollupPluginEsbuild from 'rollup-plugin-esbuild';
import RollupPluginInjectProcessEnv from 'rollup-plugin-inject-process-env';
import { terser } from 'rollup-plugin-terser';
import Typescript from 'typescript';

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
export function rollupConfigFactory(dirname, packageJson) {
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
        RollupPluginNodeResolve(),
        RollupPluginReplace({ __VERSION__: packageJson.version }),
        createTypescriptPlugin(),
        RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
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
        RollupPluginEsbuild({
          define: {
            'process.env.NODE_ENV': 'production',
          },
          target: 'es2015',
        }),

        terser({
          mangle: {
            reserved: ['createRuntime', 'Module', 'Runtime'],
          },
        }),
      ],
    },
  ];
}
