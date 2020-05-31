/* global __magic__ globalThis */
'use strict';

module.exports = (function () {
  if (typeof globalThis === 'object') return globalThis;
  Object.prototype.__defineGetter__('__magic__', function () {
    return this;
  });
  __magic__.globalThis = __magic__;
  delete Object.prototype.__magic__;

  return globalThis;
})();
