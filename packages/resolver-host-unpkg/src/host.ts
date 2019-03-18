import { Decoder } from '@velcro/decoder';
import { failure } from 'io-ts/lib/PathReporter';
import LRU from 'lru-cache';
import { satisfies, validRange } from 'semver';

import { ResolverHost, ResolvedEntry, ResolvedEntryKind, Resolver } from '@velcro/resolver';
import { IGNORE_DEPENDENCY, THROWS_DEPENDENCY } from './constants';
import { EntryNotFoundError } from './error';
import { BareModuleSpec, Directory, PackageJson, Spec, customFetch } from './types';
import { parseUnpkgUrl, parseModuleSpec, parseBufferAsPackageJson } from './util';

const UNPKG_PROTOCOL = 'https:';
const UNPKG_HOST = 'unpkg.com';

const NODE_BUILTINS = [
  'async_hooks',
  'assert',
  'buffer',
  'child_process',
  'console',
  'constants',
  'crypto',
  'cluster',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  '_stream_readable',
  '_stream_writable',
  '_stream_duplex',
  '_stream_transform',
  '_stream_passthrough',
  '_stream_wrap',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  '_tls_common',
  '_tls_wrap',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'zlib',
  'v8/tools/splaytree',
  'v8/tools/codemap',
  'v8/tools/consarray',
  'v8/tools/csvparser',
  'v8/tools/profile',
  'v8/tools/profile_view',
  'v8/tools/logreader',
  'v8/tools/arguments',
  'v8/tools/tickprocessor',
  'v8/tools/SourceMap',
  'v8/tools/tickprocessor-driver',
  'node-inspect/lib/_inspect',
  'node-inspect/lib/internal/inspect_client',
  'node-inspect/lib/internal/inspect_repl',
];

// const NODE_CORE_SHIMS: { [name: string]: string | typeof IGNORE_DEPENDENCY } = {
//   assert: 'assert@1.4.1',
//   buffer: 'buffer@5.2.1',
//   crypto: 'crypto-browserify@3.12.0',
//   events: 'events@3.0.0',
//   fs: 'memory-fs',
//   http: 'stream-http@3.0.0',
//   https: 'https-browserify@1.0.0',
//   module: IGNORE_DEPENDENCY,
//   net: 'node-libs-browser@2.2.0/mock/net.js',
//   os: 'os-browserify@0.3.0',
//   path: 'path-browserify@1.0.0',
//   querystring: 'querystring-es3@0.2.1',
//   stream: 'stream-browserify@2.0.2',
//   tls: 'node-libs-browser@2.2.0/mock/tls.js',
//   url: 'url@0.11.0',
//   util: 'util@0.11.0',
//   vm: 'vm-browserify@1.1.0',
//   zlib: 'browserify-zlib@0.2.0',
// };

const NODE_CORE_SHIMS = Object.values(NODE_BUILTINS).reduce(
  (acc, name) => {
    acc[name] = IGNORE_DEPENDENCY;
    return acc;
  },
  {} as { [name: string]: string | typeof IGNORE_DEPENDENCY }
);

interface UnpkgPackageHostOptions {
  fetch?: customFetch;
}

export class Host implements ResolverHost {
  private readonly contentCache = new LRU<string, ArrayBuffer>({
    length(buf) {
      return buf.byteLength;
    },
    max: 1024 * 1024 * 5,
  });
  private readonly decoder = new Decoder();
  private readonly fetch: customFetch;
  private readonly inflightContentRequests = new Map<string, Promise<ArrayBuffer>>();
  private readonly packageLock = new Map<string, Promise<any>>();
  private readonly packageEntriesCache = new Map<string, Map<string, Directory>>();
  private readonly packageJsonCache = new Map<string, Map<string, PackageJson>>();

  public static NODE_BUILTINS = NODE_BUILTINS;

  constructor(options: UnpkgPackageHostOptions = {}) {
    if (!options.fetch && typeof fetch !== 'function') {
      throw new TypeError(
        `A fetch function must be provided to the ${this.constructor.name} if the environment doesn't provide one`
      );
    }

    this.fetch = options.fetch || ((input: RequestInfo, init?: RequestInit | undefined) => fetch(input, init));
  }

  async getCanonicalUrl(resolver: Resolver, url: URL) {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to list non-unpkg entries for ${url.href}`);
    }

    const unresolvedSpec = parseUnpkgUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec);

    return new URL(
      `${UNPKG_PROTOCOL}//${UNPKG_HOST}/${packageJson.name}@${packageJson.version}${unresolvedSpec.pathname}`
    );
  }

  async getResolveRoot(resolver: Resolver, url: URL): Promise<URL> {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to list non-unpkg entries for ${url.href}`);
    }

    const unresolvedSpec = parseUnpkgUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec);

    return new URL(`${UNPKG_PROTOCOL}//${UNPKG_HOST}/${packageJson.name}@${packageJson.version}/`);
  }

  async listEntries(resolver: Resolver, url: URL): Promise<ResolvedEntry[]> {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to list non-unpkg entries for ${url.href}`);
    }

    const rootUrl = await resolver.host.getResolveRoot(resolver, url);
    const unresolvedSpec = parseUnpkgUrl(url);
    const packageJson = await this.readPackageJsonWithCache(resolver, unresolvedSpec);

    url.pathname = `/${packageJson.name}@${packageJson.version}${unresolvedSpec.pathname}`;

    let parentEntry: Directory | undefined = await this.readPackageEntriesWithCache(parseUnpkgUrl(url));

    const traversalSegments = unresolvedSpec.pathname.split('/').filter(Boolean);

    while (parentEntry && traversalSegments.length) {
      const segment = traversalSegments.shift() as string;

      if (parentEntry.type !== ResolvedEntryKind.Directory || !parentEntry.files) {
        throw new EntryNotFoundError(url);
      }

      parentEntry = parentEntry.files.find(
        file => file.type === ResolvedEntryKind.Directory && Resolver.path.basename(file.path) === segment
      ) as Directory | undefined;
    }

    if (!parentEntry) {
      throw new EntryNotFoundError(url);
    }

    if (!parentEntry.files) {
      return [];
    }

    return parentEntry.files.map(entry => {
      return {
        type: entry.type,
        url: new URL(`.${entry.path}`, rootUrl),
      };
    });
  }

  async readFileContent(_: Resolver, url: URL): Promise<ArrayBuffer> {
    if (url.protocol !== UNPKG_PROTOCOL || url.hostname !== UNPKG_HOST) {
      throw new Error(`Unable to read file contents for non-unpkg entries for ${url.href}`);
    }

    const href = url.href;
    const cached = this.contentCache.get(href);

    if (cached) {
      // console.log('[HIT] readFileContent(%s)', href);
      return cached;
    }

    const inflight = this.inflightContentRequests.get(href);

    if (inflight) {
      // console.log('[AWAIT] readFileContent(%s)', href);
      return inflight;
    }

    // console.log('[MISS] readFileContent(%s)', href);
    const promise = (async () => {
      const fetch = this.fetch;
      const res = await fetch(href, {
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`Error reading file content for ${href}: ${res.status}`);
      }

      const ab = await res.arrayBuffer();

      return ab;
    })();

    this.inflightContentRequests.set(href, promise);

    try {
      const buf = await promise;
      this.contentCache.set(href, buf);

      return buf;
    } finally {
      this.inflightContentRequests.delete(href);
    }
  }

  async resolveBareModuleSpecifier(resolver: Resolver, spec: string, parentUrl: URL) {
    const parentUrlRoot = await resolver.host.getResolveRoot(resolver, parentUrl);
    const parsedSpec = parseModuleSpec(spec);
    const manifestUrl = new URL(Resolver.path.resolve(parentUrlRoot.pathname, './package.json'), parentUrlRoot);

    let dependencies: { [name: string]: string } = {};

    try {
      const parentPackageJsonContent = await resolver.host.readFileContent(resolver, manifestUrl);
      const parentPackageJson = parseBufferAsPackageJson(this.decoder, parentPackageJsonContent);

      dependencies = {
        ...(parentPackageJson.devDependencies || {}),
        ...(parentPackageJson.dependencies || {}),
      };
    } catch (err) {
      console.warn(`Error reading the package manifest for ${parentUrl.href} from ${manifestUrl.href}: ${err.message}`);
    }

    if (!Object.hasOwnProperty.call(dependencies, parsedSpec.name)) {
      if (!Object.hasOwnProperty.call(NODE_CORE_SHIMS, parsedSpec.name)) {
        return THROWS_DEPENDENCY;
      }

      const shim = NODE_CORE_SHIMS[parsedSpec.name];

      if (shim === IGNORE_DEPENDENCY) {
        return IGNORE_DEPENDENCY;
      }

      return new URL(`${UNPKG_PROTOCOL}//${UNPKG_HOST}/${shim}${parsedSpec.pathname}`);
    }

    const versionSpec = dependencies[parsedSpec.name];

    return new URL(`${UNPKG_PROTOCOL}//${UNPKG_HOST}/${parsedSpec.name}@${versionSpec}${parsedSpec.pathname}`);
  }

  private async readPackageEntriesWithCache(spec: Spec): Promise<Directory> {
    const lockKey = `entries:${spec.name}`;
    const lock = this.packageLock.get(lockKey);

    if (lock) {
      // console.log('[LOCK] readPackageEntriesWithCache.awaitLock(%s)', lockKey);
      await lock;
    }

    const range = validRange(spec.version);

    if (!range) {
      throw new Error(`Invalid SemVer range for spec ${spec.spec}`);
    }

    let packageEntriesCacheForModule = this.packageEntriesCache.get(spec.name);

    if (packageEntriesCacheForModule) {
      const exactMatch = packageEntriesCacheForModule.get(spec.version);

      if (exactMatch) {
        // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
        return exactMatch;
      }

      for (const [version, packageEntries] of packageEntriesCacheForModule) {
        if (satisfies(version, range)) {
          // console.log('[HIT] readPackageEntriesWithCache(%s)', spec.spec);
          return packageEntries;
        }
      }
    } else {
      packageEntriesCacheForModule = new Map();
      this.packageEntriesCache.set(spec.name, packageEntriesCacheForModule);
    }

    // console.log('[MISS] readPackageEntriesWithCache(%s)', spec.spec);
    const promise = this.readPackageEntries(spec.spec);

    this.packageLock.set(lockKey, promise);
    const packageEntries = await promise;
    this.packageLock.delete(lockKey);

    packageEntriesCacheForModule.set(spec.version, packageEntries);

    return packageEntries;
  }

  private async readPackageJsonWithCache(resolver: Resolver, spec: Spec): Promise<PackageJson> {
    const lockKey = `packageJson:${spec.spec}`;
    const lock = this.packageLock.get(lockKey);

    if (lock) {
      // console.log('[LOCK] readPackageJsonWithCache.awaitLock(%s)', lockKey);
      await lock;
    }

    let packageJsonCacheForModule = this.packageJsonCache.get(spec.name);

    if (packageJsonCacheForModule) {
      const exactMatch = packageJsonCacheForModule.get(spec.version);

      if (exactMatch) {
        // console.log('[HIT-EXACT] readPackageJsonWithCache(%s)', spec.spec);
        return exactMatch;
      }

      const range = validRange(spec.version);

      if (range) {
        for (const [version, packageJson] of packageJsonCacheForModule) {
          if (satisfies(version, range)) {
            // console.log('[HIT] readPackageJsonWithCache(%s)', spec.spec);
            return packageJson;
          }
        }
      }
    } else {
      packageJsonCacheForModule = new Map();
      this.packageJsonCache.set(spec.name, packageJsonCacheForModule);
    }

    // console.log('[MISS] readPackageJsonWithCache(%s)', spec.spec);
    const promise = this.readPackageJson(resolver, spec.spec);

    this.packageLock.set(lockKey, promise);
    const packageJson = await promise;
    this.packageLock.delete(lockKey);

    packageJsonCacheForModule.set(packageJson.version, packageJson);

    return packageJson;
  }

  private async readPackageJson(resolver: Resolver, spec: string): Promise<PackageJson> {
    // console.log('readPackageJson(%s)', spec);

    const href = `${UNPKG_PROTOCOL}//${UNPKG_HOST}/${spec}/package.json`;
    const content = await this.readFileContent(resolver, new URL(href));

    let json: unknown;

    try {
      const text = this.decoder.decode(content);

      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`Error parsing manifest as json for package ${spec}: ${err.message}`);
    }

    const manifest = PackageJson.decode(json).getOrElseL(errors => {
      throw new Error(`Unexpected manifest for the package ${spec}: ${failure(errors).join(', ')}`);
    });

    return manifest;
  }

  private async readPackageEntries(spec: string): Promise<Directory> {
    // console.log('readPackageEntries(%s)', spec);

    const href = `${UNPKG_PROTOCOL}//${UNPKG_HOST}/${spec}/?meta`;
    const fetch = this.fetch;
    const res = await fetch(href);

    if (!res.ok) {
      throw new Error(`Error listing package contents for ${spec}`);
    }

    const json = await res.json();
    const root = Directory.decode(json).getOrElseL(errors => {
      throw new Error(
        `Unexpected response payload while listing package contents for ${spec}: ${failure(errors).join(', ')}`
      );
    });

    return root;
  }

  static resolveBareModule(_: ResolverHost, spec: BareModuleSpec) {
    return new URL(`${UNPKG_PROTOCOL}//${UNPKG_HOST}/${spec.name}@${spec.spec}${spec.pathname}`);
  }
}
