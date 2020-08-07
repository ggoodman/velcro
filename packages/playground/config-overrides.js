//@ts-check
'use strict';

const { addWebpackPlugin, override, addBabelPlugin } = require('customize-cra');
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin');
const WorkerPlugin = require('worker-plugin');

const supportMjs = () => (webpackConfig) => {
  webpackConfig.module.rules.push({
    test: /\.mjs$/,
    include: /node_modules/,
    type: 'javascript/auto',
  });
  return webpackConfig;
};

module.exports = override(
  addWebpackPlugin(new MonacoEditorWebpackPlugin()),
  addWebpackPlugin(new WorkerPlugin()),
  addBabelPlugin([
    'emotion',
    {
      instances: ['emotion', './src/lib/styled.ts'],
    },
  ]),
  supportMjs()
);
