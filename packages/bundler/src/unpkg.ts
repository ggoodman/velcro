import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { Resolver } from '@velcro/resolver';
import { CancellationToken } from 'ts-primitives';

import { parseBareModuleSpec } from './util';

const BARE_MODULE_PREFIX = 'https://unpkg.com/';

// const DEFAULT_SHIM_GLOBALS: { [key: string]: { spec: string; export?: string } } = {
//   Buffer: {
//     spec: `@velcro/node-libs@${nodeLibsVersion}/lib/buffer.js`,
//     export: 'Buffer',
//   },
//   global: {
//     spec: `@velcro/node-libs@${nodeLibsVersion}/lib/global.js`,
//   },
//   process: {
//     spec: `@velcro/node-libs@${nodeLibsVersion}/lib/process.js`,
//   },
// };

const NODE_CORE_SHIMS = [
  'assert',
  'buffer',
  'constants',
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
NODE_CORE_SHIMS['punycode'] = 'punycode@2.1.1';

export const resolveBareModuleToUnpkgWithDetails = async (
  resolver: Resolver,
  href: string,
  parentHref: string | undefined,
  { syntheticDependencies, token }: { syntheticDependencies?: Record<string, string>; token?: CancellationToken } = {}
) => {
  const parsedSpec = parseBareModuleSpec(href);
  const details = { bareModule: {}, resolvedUrl: undefined } as {
    bareModule: {
      isBuiltIn: boolean;
      versionSpec?: string;
      version?: string;
    };
    ignored: boolean;
    resolvedUrl?: URL;
    stableRootUrl?: URL;
    stableUrl?: URL;
    rootUrl: URL;
  };

  // let resolvedSpec: string | undefined = undefined;
  let resolvedSpecRoot: string | undefined = undefined;
  let unresolvedHref: string | undefined = undefined;

  if (parsedSpec.spec) {
    // A manually-specified spec means we should use that instead of looking for a parent package.json
    resolvedSpecRoot = parsedSpec.nameSpec;
  } else {
    if (syntheticDependencies && parsedSpec.name in syntheticDependencies) {
      resolvedSpecRoot = `${parsedSpec.name}@${syntheticDependencies[parsedSpec.name]}`;
    } else if (parentHref) {
      // If there is a parentHref, we want to resolve based on the spec from the including file's
      // package.json, if such exists. For example if we're requring prop-types/checkPropTypes from react-dom,
      // we want to check react-dom's package.json for the version constraints for prop-types.
      let parentUrl: URL;

      try {
        parentUrl = new URL(parentHref);
      } catch (err) {
        throw new Error(
          `Error loading bare module ${href} because the parent module ${parentHref} could not be resolved to a URL`
        );
      }

      try {
        const parentPackageInfo = await resolver.readParentPackageJson(parentUrl, { token });

        if (parentPackageInfo) {
          const consolidatedDependencies = {
            ...(parentPackageInfo.packageJson.peerDependencies || {}),
            ...(parentPackageInfo.packageJson.devDependencies || {}),
            ...(parentPackageInfo.packageJson.dependencies || {}),
          };

          details.bareModule.versionSpec = consolidatedDependencies[parsedSpec.name];

          if (details.bareModule.versionSpec) {
            resolvedSpecRoot = `${parsedSpec.name}@${details.bareModule.versionSpec}`;
          }
        }
      } catch (_) {
        // Ignore
      }
    }
  }

  if (resolvedSpecRoot) {
    // The name + spec was hard-coded or could be derived from a parent package.json. We just
    // need to prepend the staic prefix and then append the requested pathname.
    resolvedSpecRoot = `${BARE_MODULE_PREFIX}${resolvedSpecRoot}`;
    unresolvedHref = `${resolvedSpecRoot}${parsedSpec.pathname}`;
  } else {
    if (!parentHref) {
      // There was no parent href from which to derive version constraints so we will take
      // the provided 'namespec' and prefix it with the static prefix. That will be the root
      // and the href can be determined by adding the requested pathname.
      resolvedSpecRoot = `${BARE_MODULE_PREFIX}${parsedSpec.nameSpec}`;
      unresolvedHref = `${resolvedSpecRoot}${parsedSpec.pathname}`;
    } else {
      const builtIn = NODE_CORE_SHIMS[href];

      if (builtIn) {
        const parsedBuiltInSpec = parseBareModuleSpec(builtIn);

        resolvedSpecRoot = `${BARE_MODULE_PREFIX}${parsedBuiltInSpec.nameSpec}`;
        unresolvedHref = `${resolvedSpecRoot}${parsedBuiltInSpec.pathname}`;
        details.bareModule.isBuiltIn = true;
      }
    }
  }

  if (unresolvedHref && resolvedSpecRoot) {
    const stableUrl = new URL(unresolvedHref);
    const stableRootUrl = new URL(resolvedSpecRoot);
    const resolveResult = await resolver.resolve(stableUrl, { token });

    details.ignored = resolveResult.ignored;
    details.stableRootUrl = stableRootUrl;
    details.stableUrl = stableUrl;

    if (resolveResult.resolvedUrl) {
      details.resolvedUrl = resolveResult.resolvedUrl;
    }

    details.rootUrl = resolveResult.rootUrl;
  }

  if (details.resolvedUrl) {
    const packageInfo = await resolver.readParentPackageJson(details.resolvedUrl, { token });

    if (packageInfo) {
      details.bareModule.version = packageInfo.packageJson.version;
    }
  }

  return details;
};
