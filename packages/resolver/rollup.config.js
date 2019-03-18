import RollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import RollupPluginCommonJs from 'rollup-plugin-commonjs';
import RollupPluginTypescript from 'rollup-plugin-typescript2';
import Typescript from 'typescript';

import pkg from './package.json';

export default [
  // browser-friendly UMD build
  {
    input: 'src/index.ts',
    output: [
      {
        name: pkg.name.replace(/[^a-z]+/g, ' ').replace(/\s+[a-z]|^[a-z]/g, c => c[1].toUpperCase()),
        file: pkg.browser,
        format: 'umd',
      },
      {
        file: pkg.main,
        format: 'cjs',
        sourcemap: true,
      },
      {
        file: pkg.module,
        format: 'esm',
        sourcemap: true,
      },
    ],
    plugins: [
      RollupPluginTypescript({
        typescript: Typescript,
        tsconfigOverride: {
          compilerOptions: {
            module: 'esnext',
          },
        },
      }),
      RollupPluginNodeResolve(),
      RollupPluginCommonJs(),
    ],
  },
];
