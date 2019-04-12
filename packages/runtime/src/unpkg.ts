import { parseBareModuleSpec } from './bare_modules';
import { GlobalInjector, BareModuleResolver } from './types';

const BARE_MODULE_PREFIX = 'https://unpkg.com/';

const DEFAULT_SHIM_GLOBALS: { [key: string]: { spec: string; export?: string } } = {
  Buffer: {
    spec: 'buffer@5.2.1',
    export: 'Buffer',
  },
  global: {
    spec: 'global@4.3.2',
  },
  process: {
    spec: 'process@0.11.0',
    export: 'default',
  },
};

const NODE_CORE_SHIMS = {
  assert: 'assert@1.4.1',
  buffer: 'buffer@5.2.1',
  crypto: 'crypto-browserify@3.12.0',
  events: 'events@3.0.0',
  fs: 'memory-fs',
  http: 'stream-http@3.0.0',
  https: 'https-browserify@1.0.0',
  net: 'node-libs-browser@2.2.0/mock/net.js',
  os: 'os-browserify@0.3.0',
  path: 'bfs-path@1.0.2',
  process: 'process@0.11.0',
  querystring: 'querystringify@2.1.0',
  stream: 'stream-browserify@2.0.2',
  tls: 'node-libs-browser@2.2.0/mock/tls.js',
  url: 'url-parse@1.4.4',
  util: 'util@0.11.0',
  vm: 'vmdom@0.0.23',
  zlib: 'browserify-zlib@0.2.0',
} as Record<string, string>;

export const injectGlobalFromUnpkg: GlobalInjector = globalName => {
  return DEFAULT_SHIM_GLOBALS[globalName];
};

export const resolveBareModuleToUnpkg: BareModuleResolver = async (_system, resolver, href, parentHref) => {
  const parsedSpec = parseBareModuleSpec(href);

  let resolvedSpec: string | undefined = undefined;
  let unresolvedHref: string | undefined = undefined;

  if (parsedSpec.spec) {
    // A manually-specified spec means we should use that instead of looking for a parent package.json
    resolvedSpec = href;
  } else if (parentHref) {
    let parentUrl: URL;

    try {
      parentUrl = new URL(parentHref);
    } catch (err) {
      throw new Error(
        `Error loading bare module ${href} because the parent module ${parentHref} could not be resolved to a URL`
      );
    }

    const parentPackageInfo = await resolver.readParentPackageJson(parentUrl);

    if (parentPackageInfo) {
      const consolidatedDependencies = {
        ...(parentPackageInfo.packageJson.peerDependencies || {}),
        ...(parentPackageInfo.packageJson.devDependencies || {}),
        ...(parentPackageInfo.packageJson.dependencies || {}),
      };

      const versionSpec = consolidatedDependencies[parsedSpec.name];

      if (versionSpec) {
        resolvedSpec = `${parsedSpec.name}@${versionSpec}${parsedSpec.pathname}`;
      }
    }
  }
  if (resolvedSpec) {
    unresolvedHref = `${BARE_MODULE_PREFIX}${resolvedSpec}`;
  } else {
    if (!parentHref) {
      unresolvedHref = `${BARE_MODULE_PREFIX}${href}`;
    } else {
      const builtIn = NODE_CORE_SHIMS[href];

      if (builtIn) {
        unresolvedHref = `${BARE_MODULE_PREFIX}${builtIn}`;
      }
    }
  }

  if (unresolvedHref) {
    const url = await resolver.resolve(new URL(unresolvedHref));

    if (url) {
      return url.href;
    }
  }

  return `${BARE_MODULE_PREFIX}@kingjs/empty-object`;
};
