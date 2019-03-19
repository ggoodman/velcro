import { Decoder } from '@velcro/decoder';
import { Resolver } from '@velcro/resolver';

import { System } from './system';

interface WebpackLoader {
  path: string;
  query: string;
  ident?: string;

  options: any;
  normal: null | ((request: string) => string);
  pitch: null | ((request: string) => string);
  raw: boolean;
  data: any;
  pitchExecuted: boolean;
  normalExecuted: boolean;

  request: any;
}

interface WebpackLoaderContext {}

interface RunLoaderOptions {
  resource: string;
  loaders: any[];
  context?: WebpackLoaderContext;
  systemLoader: System;
  resolver: Resolver;
}

interface RunLoaderResult {
  result?: (ArrayBuffer | string)[];
  resourceBuffer?: ArrayBuffer | null;
  cacheable: boolean;
  fileDependencies: string[];
  contextDependencies: string[];
}

interface ExtendedLoaderContext {
  context: string | null;
  loaderIndex: number;
  loaders: WebpackLoader[];
  resourcePath: string | undefined;
  resourceQuery: string | undefined;
  async: (() => ((...args: any[]) => void) | undefined) | null;
  callback: ((...args: any[]) => void) | null;
  cacheable: (flag: boolean) => void;
  dependency: (file: string) => void;
  addDependency: (file: string) => void;
  addContextDependency: (context: string) => void;
  getDependencies: () => string[];
  getContextDependencies: () => string[];
  clearDependencies: () => void;
  resource: string;
  request: string;
  remainingRequest: string;
  currentRequest: string;
  previousRequest: string;
  query:
    | {
        [key: string]: any;
      }
    | string;
  data: any;
}

interface ProcessOptions {
  decoder: Decoder;
  readResource(id: string, cb: (err: Error | null, data?: ArrayBuffer) => void): void;
  systemLoader: System;
  resourceBuffer?: ArrayBuffer;
}

function splitQuery(req: string): [string, string] {
  var i = req.indexOf('?');
  if (i < 0) return [req, ''];
  return [req.substr(0, i), req.substr(i)];
}

function dirname(path: string) {
  if (path === '/') return '/';
  var i = path.lastIndexOf('/');
  var j = path.lastIndexOf('\\');
  var i2 = path.indexOf('/');
  var j2 = path.indexOf('\\');
  var idx = i > j ? i : j;
  var idx2 = i > j ? i2 : j2;
  if (idx < 0) return path;
  if (idx === idx2) return path.substr(0, idx + 1);
  return path.substr(0, idx);
}

function createLoaderObject(loader: WebpackLoader): WebpackLoader {
  var obj: WebpackLoader = {
    path: '',
    query: '',
    options: null,
    ident: undefined,
    normal: null,
    pitch: null,
    raw: false,
    data: null,
    pitchExecuted: false,
    normalExecuted: false,
  } as WebpackLoader;
  Object.defineProperty(obj, 'request', {
    enumerable: true,
    get: function() {
      return obj.path + obj.query;
    },
    set: function(value: string | { loader: string; options?: any; ident?: string }) {
      if (typeof value === 'string') {
        var splittedRequest = splitQuery(value);
        obj.path = splittedRequest[0];
        obj.query = splittedRequest[1];
        obj.options = undefined;
        obj.ident = undefined;
      } else {
        if (!value.loader)
          throw new Error(
            'request should be a string or object with loader and object (' + JSON.stringify(value) + ')'
          );
        obj.path = value.loader;
        obj.options = value.options;
        obj.ident = value.ident;
        if (obj.options === null) obj.query = '';
        else if (obj.options === undefined) obj.query = '';
        else if (typeof obj.options === 'string') obj.query = '?' + obj.options;
        else if (obj.ident) obj.query = '??' + obj.ident;
        else if (typeof obj.options === 'object' && obj.options.ident) obj.query = '??' + obj.options.ident;
        else obj.query = '?' + JSON.stringify(obj.options);
      }
    },
  });
  obj.request = loader;
  if (Object.preventExtensions) {
    Object.preventExtensions(obj);
  }
  return obj;
}

function runSyncOrAsync(
  fn: Function,
  context: ExtendedLoaderContext,
  args: any[],
  callback: (err: null | Error, ...args: any[]) => void
) {
  var isSync = true;
  var isDone = false;
  var isError = false; // internal error
  var reportedError = false;
  context.async = function async() {
    if (isDone) {
      if (reportedError) return; // ignore
      throw new Error('async(): The callback was already called.');
    }
    isSync = false;
    return innerCallback;
  };
  var innerCallback = (context.callback = function(err: null | Error, ...args: any[]) {
    if (isDone) {
      if (reportedError) return; // ignore
      throw new Error('callback(): The callback was already called.');
    }
    isDone = true;
    isSync = false;
    try {
      callback.apply(null, [err, ...args]);
    } catch (e) {
      isError = true;
      throw e;
    }
  });
  try {
    var result = (function LOADER_EXECUTION() {
      return fn.apply(context, args);
    })();
    if (isSync) {
      isDone = true;
      if (result === undefined) return callback(null);
      if (result && typeof result === 'object' && typeof result.then === 'function') {
        return result.then(function(r: any) {
          callback(null, r);
        }, callback);
      }
      return callback(null, result);
    }
  } catch (e) {
    if (isError) throw e;
    if (isDone) {
      // loader is already "done", so we cannot use the callback function
      // for better debugging we print the error on the console
      if (typeof e === 'object' && e.stack) console.error(e.stack);
      else console.error(e);
      return;
    }
    isDone = true;
    reportedError = true;
    callback(e);
  }
}

function convertArgs(decoder: Decoder, args: any[], raw?: boolean) {
  if (!raw && typeof args[0] !== 'string') args[0] = decoder.decode(args[0]);
  else if (raw && typeof args[0] === 'string') args[0] = Buffer.from(args[0], 'utf-8');
}

function iteratePitchingLoaders(
  options: ProcessOptions,
  loaderContext: ExtendedLoaderContext,
  callback: (err: null | Error, result?: any) => void
): void {
  // abort after last loader
  if (loaderContext.loaderIndex >= loaderContext.loaders.length)
    return processResource(options, loaderContext, callback);

  var currentLoaderObject = loaderContext.loaders[loaderContext.loaderIndex];

  // iterate
  if (currentLoaderObject.pitchExecuted) {
    loaderContext.loaderIndex++;
    return iteratePitchingLoaders(options, loaderContext, callback);
  }

  // load loader module
  loadLoader(options.systemLoader, currentLoaderObject, function(err) {
    if (err) {
      loaderContext.cacheable(false);
      return callback(err);
    }
    var fn = currentLoaderObject.pitch;
    currentLoaderObject.pitchExecuted = true;
    if (!fn) return iteratePitchingLoaders(options, loaderContext, callback);

    runSyncOrAsync(
      fn,
      loaderContext,
      [loaderContext.remainingRequest, loaderContext.previousRequest, (currentLoaderObject.data = {})],
      function(err) {
        if (err) return callback(err);
        var args = Array.prototype.slice.call(arguments, 1);
        // Determine whether to continue the pitching process based on
        // argument values (as opposed to argument presence) in order
        // to support synchronous and asynchronous usages.
        var hasArg = args.some(function(value) {
          return value !== undefined;
        });
        if (hasArg) {
          loaderContext.loaderIndex--;
          iterateNormalLoaders(options, loaderContext, args, callback);
        } else {
          iteratePitchingLoaders(options, loaderContext, callback);
        }
      }
    );
  });
}

function processResource(
  options: ProcessOptions,
  loaderContext: ExtendedLoaderContext,
  callback: (err: null | Error, result?: any) => void
) {
  // set loader index to last loader
  loaderContext.loaderIndex = loaderContext.loaders.length - 1;

  var resourcePath = loaderContext.resourcePath;
  if (resourcePath) {
    loaderContext.addDependency(resourcePath);
    options.readResource(resourcePath, function(err, buffer) {
      if (err) return callback(err);
      options.resourceBuffer = buffer;
      iterateNormalLoaders(options, loaderContext, [buffer], callback);
    });
  } else {
    iterateNormalLoaders(options, loaderContext, [null], callback);
  }
}

function iterateNormalLoaders(
  options: ProcessOptions,
  loaderContext: ExtendedLoaderContext,
  args: any[],
  callback: (err: null | Error, args?: any[]) => void
): void {
  if (loaderContext.loaderIndex < 0) return callback(null, args);

  var currentLoaderObject = loaderContext.loaders[loaderContext.loaderIndex];

  // iterate
  if (currentLoaderObject.normalExecuted) {
    loaderContext.loaderIndex--;
    return iterateNormalLoaders(options, loaderContext, args, callback);
  }

  var fn = currentLoaderObject.normal;
  currentLoaderObject.normalExecuted = true;
  if (!fn) {
    return iterateNormalLoaders(options, loaderContext, args, callback);
  }

  convertArgs(options.decoder, args, currentLoaderObject.raw);

  runSyncOrAsync(fn, loaderContext, args, function(err: Error | null) {
    if (err) return callback(err);

    var args = Array.prototype.slice.call(arguments, 1);
    iterateNormalLoaders(options, loaderContext, args, callback);
  });
}

exports.getContext = function getContext(resource: string) {
  var splitted = splitQuery(resource);
  return dirname(splitted[0]);
};

export function runLoaders(options: RunLoaderOptions): Promise<RunLoaderResult> {
  return new Promise((resolve, reject) => {
    return runLoadersWithCb(options, (err, result) => {
      if (err) {
        return reject(err);
      }

      return resolve(result);
    });
  });
}

export function runLoadersWithCb(
  options: RunLoaderOptions,
  callback: (err: Error | null, result?: RunLoaderResult) => void
) {
  // read options
  var resource = options.resource || '';
  var loaders = options.loaders || [];
  var loaderContext = (options.context || {}) as any;

  //
  var splittedResource = resource && splitQuery(resource);
  var resourcePath = splittedResource ? splittedResource[0] : undefined;
  var resourceQuery = splittedResource ? splittedResource[1] : undefined;
  var contextDirectory = resourcePath ? dirname(resourcePath) : null;

  // execution state
  var requestCacheable = true;
  var fileDependencies = [] as string[];
  var contextDependencies = [] as any[];

  // prepare loader objects
  loaders = loaders.map(createLoaderObject);

  loaderContext.context = contextDirectory;
  loaderContext.loaderIndex = 0;
  loaderContext.loaders = loaders;
  loaderContext.resourcePath = resourcePath;
  loaderContext.resourceQuery = resourceQuery;
  loaderContext.async = null;
  loaderContext.callback = null;
  loaderContext.cacheable = function cacheable(flag: boolean) {
    if (flag === false) {
      requestCacheable = false;
    }
  };
  loaderContext.dependency = loaderContext.addDependency = function addDependency(file: string) {
    fileDependencies.push(file);
  };
  loaderContext.addContextDependency = function addContextDependency(context: any) {
    contextDependencies.push(context);
  };
  loaderContext.getDependencies = function getDependencies() {
    return fileDependencies.slice();
  };
  loaderContext.getContextDependencies = function getContextDependencies() {
    return contextDependencies.slice();
  };
  loaderContext.clearDependencies = function clearDependencies() {
    fileDependencies.length = 0;
    contextDependencies.length = 0;
    requestCacheable = true;
  };
  Object.defineProperty(loaderContext, 'resource', {
    enumerable: true,
    get: function() {
      if (loaderContext.resourcePath === undefined) return undefined;
      return loaderContext.resourcePath + loaderContext.resourceQuery;
    },
    set: function(value) {
      var splittedResource = value && splitQuery(value);
      loaderContext.resourcePath = splittedResource ? splittedResource[0] : undefined;
      loaderContext.resourceQuery = splittedResource ? splittedResource[1] : undefined;
    },
  });
  Object.defineProperty(loaderContext, 'request', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .map(function(o: WebpackLoader) {
          return o.request;
        })
        .concat(loaderContext.resource || '')
        .join('!');
    },
  });
  Object.defineProperty(loaderContext, 'remainingRequest', {
    enumerable: true,
    get: function() {
      if (loaderContext.loaderIndex >= loaderContext.loaders.length - 1 && !loaderContext.resource) return '';
      return loaderContext.loaders
        .slice(loaderContext.loaderIndex + 1)
        .map(function(o: WebpackLoader) {
          return o.request;
        })
        .concat(loaderContext.resource || '')
        .join('!');
    },
  });
  Object.defineProperty(loaderContext, 'currentRequest', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .slice(loaderContext.loaderIndex)
        .map(function(o: WebpackLoader) {
          return o.request;
        })
        .concat(loaderContext.resource || '')
        .join('!');
    },
  });
  Object.defineProperty(loaderContext, 'previousRequest', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders
        .slice(0, loaderContext.loaderIndex)
        .map(function(o: WebpackLoader) {
          return o.request;
        })
        .join('!');
    },
  });
  Object.defineProperty(loaderContext, 'query', {
    enumerable: true,
    get: function() {
      var entry = loaderContext.loaders[loaderContext.loaderIndex];
      return entry.options && typeof entry.options === 'object' ? entry.options : entry.query;
    },
  });
  Object.defineProperty(loaderContext, 'data', {
    enumerable: true,
    get: function() {
      return loaderContext.loaders[loaderContext.loaderIndex].data;
    },
  });

  // finish loader context
  if (Object.preventExtensions) {
    Object.preventExtensions(loaderContext);
  }

  var processOptions: ProcessOptions = {
    decoder: options.resolver.decoder,
    systemLoader: options.systemLoader,
    resourceBuffer: undefined,
    async readResource(id: string, cb: (err: Error | null, data?: ArrayBuffer) => void) {
      const url = await options.resolver.resolve(id);

      if (!url) {
        return cb(new Error(`Unable to read unresolvable file: ${id}`));
      }

      options.resolver.host.readFileContent(options.resolver, url).then(data => {
        return cb(null, data);
      }, cb);
    },
  };
  iteratePitchingLoaders(processOptions, loaderContext, function(err: Error | null, result?: any) {
    if (err) {
      return callback(err, {
        cacheable: requestCacheable,
        fileDependencies: fileDependencies,
        contextDependencies: contextDependencies,
      });
    }
    callback(null, {
      result: result,
      resourceBuffer: processOptions.resourceBuffer,
      cacheable: requestCacheable,
      fileDependencies: fileDependencies,
      contextDependencies: contextDependencies,
    });
  });
}

function loadLoader(systemLoader: System, loader: WebpackLoader, callback: (err?: LoaderRunnerError) => void): void {
  return void systemLoader.import(loader.path).then(
    module => {
      if (typeof module !== 'function' && typeof module !== 'object') {
        return callback(
          new LoaderRunnerError("Module '" + loader.path + "' is not a loader (export function or es6 module)")
        );
      }
      loader.normal = typeof module === 'function' ? module : module.default;
      loader.pitch = module.pitch;
      loader.raw = module.raw;
      if (typeof loader.normal !== 'function' && typeof loader.pitch !== 'function') {
        return callback(
          new LoaderRunnerError("Module '" + loader.path + "' is not a loader (must have normal or pitch function)")
        );
      }
      callback();
    },
    err => callback(err)
  );
}

class LoaderRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoaderRunnerError';
    Error.captureStackTrace(this, this.constructor);
  }
}
