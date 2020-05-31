'use strict';

module.exports = (function () {
  if (typeof globalThis === 'object') return;
  Object.prototype.__defineGetter__('__magic__', function () {
    return this;
  });
  // eslint-disable-next-line no-undef
  __magic__.globalThis = __magic__;
  delete Object.prototype.__magic__;

  // eslint-disable-next-line no-undef
  return globalThis;
})();
