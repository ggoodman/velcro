module.exports = [
  ...require('./packages/@velcro/common/rollup.config'),
  ...require('./packages/@velcro/resolver/rollup.config'),
  ...require('./packages/@velcro/bundler/rollup.config'),
  ...require('./packages/@velcro/strategy-cdn/rollup.config'),
  ...require('./packages/@velcro/strategy-compound/rollup.config'),
  ...require('./packages/@velcro/strategy-fs/rollup.config'),
  ...require('./packages/@velcro/strategy-memory/rollup.config'),
  ...require('./packages/@velcro/plugin-css/rollup.config'),
  ...require('./packages/@velcro/plugin-sucrase/rollup.config'),
  ...require('./packages/@velcro/runner/rollup.config'),
  ...require('./packages/nostalgie/rollup.config'),
];
