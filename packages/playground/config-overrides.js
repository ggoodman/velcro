const { addWebpackPlugin, override, useBabelRc } = require('customize-cra');
const MonacoEditorWebpackPlugin = require('monaco-editor-webpack-plugin');

module.exports = override(addWebpackPlugin(new MonacoEditorWebpackPlugin()), useBabelRc());
