const VelcroBundlerConfig = require('./packages/@velcro/bundler/rollup.config');
const VelcroCommonConfig = require('./packages/@velcro/common/rollup.config');
const VelcroResolverConfig = require('./packages/@velcro/resolver/rollup.config');
const VelcroRunnerConfig = require('./packages/@velcro/runner/rollup.config');
const VelcroStrategyCdnConfig = require('./packages/@velcro/strategy-cdn/rollup.config');
const VelcroStrategyCompoundConfig = require('./packages/@velcro/strategy-compound/rollup.config');
const VelcroStrategyFsConfig = require('./packages/@velcro/strategy-fs/rollup.config');
const VelcroStrategyMemoryConfig = require('./packages/@velcro/strategy-memory/rollup.config');

/** @type {import('rollup').RollupOptions[]} */
const config = [
  ...VelcroCommonConfig,
  ...VelcroResolverConfig,
  ...VelcroBundlerConfig,
  ...VelcroStrategyCdnConfig,
  ...VelcroStrategyCompoundConfig,
  ...VelcroStrategyFsConfig,
  ...VelcroStrategyMemoryConfig,
  ...VelcroRunnerConfig,
];

module.exports = config;
