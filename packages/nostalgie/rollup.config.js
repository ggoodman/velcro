const PackageJson = require('./package.json');
const { rollupConfigFactory } = require('../../rollup.config.factory');

module.exports = rollupConfigFactory(__dirname, PackageJson);
