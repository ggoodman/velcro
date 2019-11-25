//@ts-check
'use strict';

const { addWebpackPlugin, override, useBabelRc, addWebpackAlias } = require('customize-cra');
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin');
const WorkerPlugin = require('worker-plugin');

module.exports = override(
  addWebpackPlugin(new MonacoEditorWebpackPlugin()),
  addWebpackPlugin(new WorkerPlugin()),
  useBabelRc(),
  addWebpackAlias({
    '@velcro/bundler': '@velcro/bundler/dist/dist-module/index.js',
    '@velcro/resolver-host-compound': '@velcro/resolver-host-compound/dist/dist-module/index.js',
    '@velcro/resolver-host-unpkg': '@velcro/resolver-host-unpkg/dist/dist-module/index.js',
    '@velcro/resolver': '@velcro/resolver/dist/dist-module/index.js',
  })
);
