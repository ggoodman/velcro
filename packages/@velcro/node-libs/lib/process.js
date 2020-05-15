'use strict';
// Use path and TTY for type information only. We lazily pull them in
// to avoid circular dependencies :(
// (path depends on process for cwd(), TTY depends on streams which depends
//  on process.nextTick/process.stdout/stderr/stdin).
var path_1 = require('./path');
var tty_1 = require('./tty');
var events_1 = require('./events');
var __extends =
  (this && this.__extends) ||
  (function() {
    var extendStatics =
      Object.setPrototypeOf ||
      ({ __proto__: [] } instanceof Array &&
        function(d, b) {
          d.__proto__ = b;
        }) ||
      function(d, b) {
        for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
      };
    return function(d, b) {
      extendStatics(d, b);
      function __() {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
  })();
function getStack() {
  try {
    throw new Error();
  } catch (e) {
    return e.stack;
  }
}
var Item = /** @class */ (function() {
  function Item(fun, array) {
    this.fun = fun;
    this.array = array;
  }
  Item.prototype.run = function() {
    this.fun.apply(null, this.array);
  };
  return Item;
})();
/**
 * Contains a queue of Items for process.nextTick.
 * Inspired by node-process: https://github.com/defunctzombie/node-process
 */
var NextTickQueue = /** @class */ (function() {
  function NextTickQueue() {
    this._queue = [];
    this._draining = false;
    // Used/assigned by the drainQueue function.
    this._currentQueue = null;
    this._queueIndex = -1;
  }
  NextTickQueue.prototype.push = function(item) {
    var _this = this;
    if (this._queue.push(item) === 1 && !this._draining) {
      setTimeout(function() {
        return _this._drainQueue();
      }, 0);
    }
  };
  NextTickQueue.prototype._cleanUpNextTick = function() {
    this._draining = false;
    if (this._currentQueue && this._currentQueue.length) {
      this._queue = this._currentQueue.concat(this._queue);
    } else {
      this._queueIndex = -1;
    }
    if (this._queue.length) {
      this._drainQueue();
    }
  };
  NextTickQueue.prototype._drainQueue = function() {
    var _this = this;
    if (this._draining) {
      return;
    }
    // If an Item throws an unhandled exception, this function will clean things up.
    var timeout = setTimeout(function() {
      return _this._cleanUpNextTick();
    });
    this._draining = true;
    var len = this._queue.length;
    while (len) {
      this._currentQueue = this._queue;
      this._queue = [];
      while (++this._queueIndex < len) {
        if (this._currentQueue) {
          this._currentQueue[this._queueIndex].run();
        }
      }
      this._queueIndex = -1;
      len = this._queue.length;
    }
    this._currentQueue = null;
    this._draining = false;
    clearTimeout(timeout);
  };
  return NextTickQueue;
})();
/**
 * Partial implementation of Node's `process` module.
 * We implement the portions that are relevant for the filesystem.
 * @see http://nodejs.org/api/process.html
 * @class
 */
var Process = /** @class */ (function(_super) {
  __extends(Process, _super);
  function Process() {
    var _this = (_super !== null && _super.apply(this, arguments)) || this;
    _this.startTime = Date.now();
    _this._cwd = '/';
    /**
     * Returns what platform you are running on.
     * @return [String]
     */
    _this.platform = 'browser';
    _this.argv = [];
    _this.execArgv = [];
    _this.stdout = tty_1;
    _this.stderr = tty_1;
    _this.stdin = tty_1;
    _this.domain = null;
    _this._queue = new NextTickQueue();
    _this.execPath = __dirname;
    _this.env = {};
    _this.exitCode = 0;
    _this._gid = 1;
    _this._errorCallback = null;
    _this._uid = 1;
    _this.version = 'v0.0.0';
    _this.versions = {};
    _this.config = {
      target_defaults: { cflags: [], default_configuration: 'Release', defines: [], include_dirs: [], libraries: [] },
      variables: {
        clang: 0,
        host_arch: 'x32',
        node_install_npm: false,
        node_install_waf: false,
        node_prefix: '',
        node_shared_cares: false,
        node_shared_http_parser: false,
        node_shared_libuv: false,
        node_shared_zlib: false,
        node_shared_v8: false,
        node_use_dtrace: false,
        node_use_etw: false,
        node_use_openssl: false,
        node_shared_openssl: false,
        strict_aliasing: false,
        target_arch: 'x32',
        v8_use_snapshot: false,
        v8_no_strict_aliasing: 0,
        visibility: '',
      },
    };
    _this.pid = (Math.random() * 1000) | 0;
    _this.ppid = (Math.random() * 1000) | 0;
    _this.title = 'node';
    _this.arch = 'x32';
    _this._mask = 18;
    _this.connected = true;
    return _this;
  }
  /**
   * Changes the current working directory.
   *
   * **Note**: BrowserFS does not validate that the directory actually exists.
   *
   * @example Usage example
   *   console.log('Starting directory: ' + process.cwd());
   *   process.chdir('/tmp');
   *   console.log('New directory: ' + process.cwd());
   * @param [String] dir The directory to change to.
   */
  Process.prototype.chdir = function(dir) {
    this._cwd = path_1.resolve(dir);
  };
  /**
   * Returns the current working directory.
   * @example Usage example
   *   console.log('Current directory: ' + process.cwd());
   * @return [String] The current working directory.
   */
  Process.prototype.cwd = function() {
    return this._cwd;
  };
  /**
   * Number of seconds BrowserFS has been running.
   * @return [Number]
   */
  Process.prototype.uptime = function() {
    return ((Date.now() - this.startTime) / 1000) | 0;
  };
  Object.defineProperty(Process.prototype, 'argv0', {
    get: function() {
      return this.argv.length > 0 ? this.argv[0] : 'node';
    },
    enumerable: true,
    configurable: true,
  });
  Process.prototype.nextTick = function(fun) {
    var args = [];
    for (var _i = 1; _i < arguments.length; _i++) {
      args[_i - 1] = arguments[_i];
    }
    this._queue.push(new Item(fun, args));
  };
  Process.prototype.abort = function() {
    this.emit('abort');
  };
  Process.prototype.exit = function(code) {
    this.exitCode = code;
    this.emit('exit', [code]);
    throw new Error('process.exit() called.');
  };
  Process.prototype.getgid = function() {
    return this._gid;
  };
  Process.prototype.getegid = function() {
    return this.getgid();
  };
  Process.prototype.setgid = function(gid) {
    if (typeof gid === 'number') {
      this._gid = gid;
    } else {
      this._gid = 1;
    }
  };
  Process.prototype.setegid = function(gid) {
    return this.setgid(gid);
  };
  Process.prototype.getgroups = function() {
    return [];
  };
  Process.prototype.setgroups = function() {
    // NOP
  };
  Process.prototype.setUncaughtExceptionCaptureCallback = function(cb) {
    if (this._errorCallback) {
      window.removeEventListener('error', this._errorCallback);
    }
    this._errorCallback = cb;
    if (cb) {
      window.addEventListener('error', cb);
    }
  };
  Process.prototype.hasUncaughtExceptionCaptureCallback = function() {
    return this._errorCallback !== null;
  };
  Process.prototype.getuid = function() {
    return this._uid;
  };
  Process.prototype.setuid = function(uid) {
    if (typeof uid === 'number') {
      this._uid = uid;
    } else {
      this._uid = 1;
    }
  };
  Process.prototype.geteuid = function() {
    return this.getuid();
  };
  Process.prototype.seteuid = function(euid) {
    this.setuid(euid);
  };
  Process.prototype.cpuUsage = function() {
    return { user: 0, system: 0 };
  };
  Process.prototype.kill = function(pid, signal) {
    this.emit('kill', [pid, signal]);
  };
  Process.prototype.memoryUsage = function() {
    return { rss: 0, heapTotal: 0, heapUsed: 0 };
  };
  Process.prototype.umask = function(mask) {
    if (mask === void 0) {
      mask = this._mask;
    }
    var oldMask = this._mask;
    this._mask = mask;
    this.emit('umask', [mask]);
    return oldMask;
  };
  Process.prototype.hrtime = function() {
    var timeinfo;
    if (typeof performance !== 'undefined') {
      timeinfo = performance.now();
    } else if (Date['now']) {
      timeinfo = Date.now();
    } else {
      timeinfo = new Date().getTime();
    }
    var secs = (timeinfo / 1000) | 0;
    timeinfo -= secs * 1000;
    timeinfo = (timeinfo * 1000000) | 0;
    return [secs, timeinfo];
  };
  Process.prototype.openStdin = function() {
    return this.stdin;
  };
  Process.prototype.emitWarning = function(warning, name) {
    var warningObj = {
      name: name ? name : typeof warning !== 'string' ? warning.name : 'Warning',
      message: typeof warning === 'string' ? warning : warning.message,
      code: 'WARNING',
      stack: typeof warning !== 'string' ? warning.stack : getStack(),
    };
    this.emit('warning', warningObj);
  };
  Process.prototype.disconnect = function() {};
  return Process;
})(events_1.EventEmitter);

module.exports = new Process();
