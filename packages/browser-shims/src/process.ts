// Use path and TTY for type information only. We lazily pull them in
// to avoid circular dependencies :(
// (path depends on process for cwd(), TTY depends on streams which depends
//  on process.nextTick/process.stdout/stderr/stdin).
import { resolve } from 'bfs-path';
import TTY from './tty';
import { EventEmitter } from 'events';

function getStack(): string {
  try {
    throw new Error();
  } catch (e) {
    return e.stack;
  }
}

class Item {
  private fun: Function;
  private array: any[];
  constructor(fun: Function, array: any[]) {
    this.fun = fun;
    this.array = array;
  }

  public run(): void {
    this.fun.apply(null, this.array);
  }
}

/**
 * Contains a queue of Items for process.nextTick.
 * Inspired by node-process: https://github.com/defunctzombie/node-process
 */
class NextTickQueue {
  private _queue: Item[] = [];
  private _draining = false;
  // Used/assigned by the drainQueue function.
  private _currentQueue: Item[] | null = null;
  private _queueIndex = -1;

  public push(item: Item): void {
    if (this._queue.push(item) === 1 && !this._draining) {
      setTimeout(() => this._drainQueue(), 0);
    }
  }

  private _cleanUpNextTick() {
    this._draining = false;
    if (this._currentQueue && this._currentQueue.length) {
      this._queue = this._currentQueue.concat(this._queue);
    } else {
      this._queueIndex = -1;
    }
    if (this._queue.length) {
      this._drainQueue();
    }
  }

  private _drainQueue() {
    if (this._draining) {
      return;
    }
    // If an Item throws an unhandled exception, this function will clean things up.
    var timeout = setTimeout(() => this._cleanUpNextTick());
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
  }
}

/**
 * Partial implementation of Node's `process` module.
 * We implement the portions that are relevant for the filesystem.
 * @see http://nodejs.org/api/process.html
 * @class
 */
export default class Process extends EventEmitter {
  private startTime = Date.now();

  private _cwd: string = '/';
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
  public chdir(dir: string): void {
    this._cwd = resolve(dir);
  }
  /**
   * Returns the current working directory.
   * @example Usage example
   *   console.log('Current directory: ' + process.cwd());
   * @return [String] The current working directory.
   */
  public cwd(): string {
    return this._cwd;
  }
  /**
   * Returns what platform you are running on.
   * @return [String]
   */
  public platform: any = 'browser';
  /**
   * Number of seconds BrowserFS has been running.
   * @return [Number]
   */
  public uptime(): number {
    return ((Date.now() - this.startTime) / 1000) | 0;
  }

  public argv: string[] = [];
  public get argv0(): string {
    return this.argv.length > 0 ? this.argv[0] : 'node';
  }
  public execArgv: string[] = [];
  public stdout: TTY = new TTY();
  public stderr: TTY = new TTY();
  public stdin: TTY = new TTY();
  public domain: NodeJS.Domain | null = null;

  private _queue: NextTickQueue = new NextTickQueue();

  public nextTick(fun: any, ...args: any[]) {
    this._queue.push(new Item(fun, args));
  }

  public execPath = __dirname;

  public abort(): void {
    this.emit('abort');
  }

  public env: { [name: string]: string } = {};
  public exitCode: number = 0;
  public exit(code: number): never {
    this.exitCode = code;
    this.emit('exit', [code]);
    throw new Error(`process.exit() called.`);
  }

  private _gid: number = 1;
  public getgid(): number {
    return this._gid;
  }
  public getegid(): number {
    return this.getgid();
  }
  public setgid(gid: number | string): void {
    if (typeof gid === 'number') {
      this._gid = gid;
    } else {
      this._gid = 1;
    }
  }
  public setegid(gid: number | string): void {
    return this.setgid(gid);
  }

  public getgroups(): number[] {
    return [];
  }
  public setgroups(groups: number[]): void {
    // NOP
  }

  private _errorCallback: any = null;
  public setUncaughtExceptionCaptureCallback(cb: any): void {
    if (this._errorCallback) {
      window.removeEventListener('error', this._errorCallback);
    }
    this._errorCallback = cb;
    if (cb) {
      window.addEventListener('error', cb);
    }
  }
  public hasUncaughtExceptionCaptureCallback(): boolean {
    return this._errorCallback !== null;
  }

  private _uid: number = 1;
  public getuid(): number {
    return this._uid;
  }
  public setuid(uid: number | string): void {
    if (typeof uid === 'number') {
      this._uid = uid;
    } else {
      this._uid = 1;
    }
  }
  public geteuid(): number {
    return this.getuid();
  }
  public seteuid(euid: number | string): void {
    this.setuid(euid);
  }

  public cpuUsage() {
    return { user: 0, system: 0 };
  }

  public version: string = 'v5.0';

  public versions = {
    http_parser: '0.0',
    node: '5.0',
    v8: '0.0',
    uv: '0.0',
    zlib: '0.0',
    ares: '0.0',
    icu: '0.0',
    modules: '0',
    openssl: '0.0',
  };

  public config = {
    target_defaults: {
      cflags: <any[]>[],
      default_configuration: 'Release',
      defines: <string[]>[],
      include_dirs: <string[]>[],
      libraries: <string[]>[],
    },
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

  public kill(pid: number, signal?: string): void {
    this.emit('kill', [pid, signal]);
  }

  public pid = (Math.random() * 1000) | 0;
  public ppid = (Math.random() * 1000) | 0;

  public title = 'node';
  public arch = 'x32';
  public memoryUsage(): { rss: number; heapTotal: number; heapUsed: number } {
    return { rss: 0, heapTotal: 0, heapUsed: 0 };
  }

  private _mask = 18;
  public umask(mask: number = this._mask): number {
    let oldMask = this._mask;
    this._mask = mask;
    this.emit('umask', [mask]);
    return oldMask;
  }

  public hrtime(): [number, number] {
    let timeinfo: number;
    if (typeof performance !== 'undefined') {
      timeinfo = performance.now();
    } else if (Date['now']) {
      timeinfo = Date.now();
    } else {
      timeinfo = new Date().getTime();
    }
    let secs = (timeinfo / 1000) | 0;
    timeinfo -= secs * 1000;
    timeinfo = (timeinfo * 1000000) | 0;
    return [secs, timeinfo];
  }

  public openStdin() {
    return this.stdin;
  }

  public emitWarning(warning: string | Error, name?: string, ctor?: Function): void {
    const warningObj = {
      name: name ? name : typeof warning !== 'string' ? warning.name : 'Warning',
      message: typeof warning === 'string' ? warning : warning.message,
      code: 'WARNING',
      stack: typeof warning !== 'string' ? warning.stack : getStack(),
    };
    this.emit('warning', warningObj);
  }

  public disconnect(): void {}
  public connected: boolean = true;
}
