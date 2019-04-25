'use strict';

module.exports = [
  ...require('./packages/decoder/rollup.config'),
  ...require('./packages/resolver/rollup.config'),
  ...require('./packages/resolver-host-compound/rollup.config'),
  ...require('./packages/resolver-host-fs/rollup.config'),
  ...require('./packages/resolver-host-memory/rollup.config'),
  ...require('./packages/resolver-host-unpkg/rollup.config'),
  ...require('./packages/runtime/rollup.config'),
];
