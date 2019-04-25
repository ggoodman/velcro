import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';

import { parseBareModuleSpec } from './bare_modules';
import { GlobalInjector, BareModuleResolver } from './types';
import { Resolver } from '@velcro/resolver';

const BARE_MODULE_PREFIX = 'https://unpkg.com/';

const DEFAULT_SHIM_GLOBALS: { [key: string]: { spec: string; export?: string } } = {
  Buffer: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/buffer.js`,
    export: 'Buffer',
  },
  global: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/global.js`,
  },
  process: {
    spec: `@velcro/node-libs@${nodeLibsVersion}/lib/process.js`,
  },
};

const NODE_CORE_SHIMS = [
  'assert',
  'buffer',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'querystring',
  'stream',
  'tls',
  'url',
  'util',
  'vm',
  'zlib',
].reduce(
  (shims, coreLibName) =>
    Object.assign(shims, { [coreLibName]: `@velcro/node-libs@${nodeLibsVersion}/lib/${coreLibName}.js` }),
  {} as Record<string, string>
);

NODE_CORE_SHIMS['string_decoder'] = 'string_decoder@1.2.0';

export const injectGlobalFromUnpkg: GlobalInjector = globalName => {
  return DEFAULT_SHIM_GLOBALS[globalName];
};

export const resolveBareModuleToUnpkg: BareModuleResolver = async (resolver: Resolver, href, parentHref) => {
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

  return undefined;
};
