import RollupPluginCommonJs from '@rollup/plugin-commonjs';
import RollupPluginJson from '@rollup/plugin-json';
import RollupPluginNodeResolve from '@rollup/plugin-node-resolve';
import RollupPluginInjectProcessEnv from 'rollup-plugin-inject-process-env';
import RollupPluginTs from '@wessberg/rollup-plugin-ts';
import { terser } from 'rollup-plugin-terser';
import * as PackageJson from './package.json';

/** @type {import('rollup').RollupOptions[]} */
const config = [
  {
    input: './src/index.ts',
    output: [
      {
        file: PackageJson.main,
        format: 'commonjs',
        sourcemap: true,
      },
      {
        file: PackageJson.module,
        format: 'esm',
        sourcemap: true,
      },
    ],
    external(id) {
      return PackageJson.dependencies && Object.hasOwnProperty.call(PackageJson.dependencies, id);
    },
    plugins: [
      // RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      RollupPluginJson(),
      RollupPluginNodeResolve(),
      RollupPluginTs({
        include: ['package.json', 'src/**/*.(js|ts)'],
        tsconfig: 'tsconfig.json',
      }),
    ],
  },
  {
    input: './src/index.ts',
    output: {
      file: PackageJson.unpkg,
      format: 'umd',
      name: 'Velcro',
      sourcemap: true,
    },
    plugins: [
      RollupPluginJson(),
      RollupPluginNodeResolve({
        browser: true,
        // mainFields: ['browser', 'main'],
        // preferBuiltins: true,
      }),
      RollupPluginCommonJs(),
      RollupPluginTs({
        include: ['package.json', 'src/**/*.(js|ts)'],
        tsconfig: 'tsconfig.json',
      }),
      RollupPluginInjectProcessEnv({ NODE_ENV: 'production' }),
      terser({
        mangle: {
          reserved: ['createRuntime', 'Module', 'Runtime'],
        },
      }),
    ],
  },
];

export default config;
