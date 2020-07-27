import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

/** @type {import('rollup').RollupOptions} */
const config = {
  input: './src/index.ts',
  output: {
    sourcemap: true,
    format: 'esm',
    file: 'dist/index.js',
  },
  plugins: [resolve(), typescript({ sourceMap: false })],
};

export default config;
