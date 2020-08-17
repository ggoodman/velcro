/* global __gt__ globalThis */
'use strict';

module.exports = (function () {
  if (typeof globalThis === 'object') return globalThis;
  Object.prototype.__defineGetter__('__gt__', function () {
    return this;
  });
  var globalThis = __gt__;
  delete Object.prototype.__gt__;
})();
