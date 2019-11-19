import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { Resolver } from '@velcro/resolver';
import { resolve as resolveNpmPackageArg } from 'npm-package-arg';
import { CancellationToken } from 'ts-primitives';

import { ResolveError, InvariantViolation } from './error';
import { parseBareModuleSpec } from './util';

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

export async function resolveBareModuleReference(
  resolver: Resolver,
  bareModuleReference: string,
  parentHref: string | undefined,
  { invalidatedBy = new Set(), token }: { invalidatedBy?: Set<string>; token?: CancellationToken } = {}
) {
  if (!bareModuleReference) {
    throw new TypeError(`Impossible to import an empty package name${parentHref ? ` from ${parentHref}` : ''}`);
  }

  const { name, pathname, spec } = parseBareModuleSpec(bareModuleReference);

  if (spec) {
    try {
      const resolvedSpec = resolveNpmPackageArg(name, spec, parentHref);

      return {
        name,
        pathname,
        resolvedSpec,
        spec,
      };
    } catch (err) {
      // TODO: Normalize error
      throw err;
    }
  }

  if (!parentHref) {
    // TODO: Good place to inject logic for automatic dependency injection
    throw new ResolveError(spec, parentHref);
  }

  let parentUrl: URL;
  try {
    parentUrl = new URL(parentHref);
  } catch (err) {
    throw new Error(
      `Error loading bare module ${spec} because the parent module ${parentHref} could not be resolved to a URL`
    );
  }

  // We are resolving a bare module *from* another file so we want to load the closest package.json of the
  // parent file and see if we can find the dependencies there.
  const parentPackageInfo = await resolver.readParentPackageJson(parentUrl, { invalidatedBy, token });

  if (parentPackageInfo) {
    invalidatedBy.add(parentPackageInfo.url.href);

    const consolidatedDependencies = {
      ...(parentPackageInfo.packageJson.peerDependencies || {}),
      ...(parentPackageInfo.packageJson.devDependencies || {}),
      ...(parentPackageInfo.packageJson.dependencies || {}),
    };
    const dependencySpec = consolidatedDependencies[name];

    if (dependencySpec) {
      try {
        const resolvedSpec = resolveNpmPackageArg(name, dependencySpec, parentHref);

        return {
          name,
          pathname,
          resolvedSpec,
          spec,
        };
      } catch (err) {
        // TODO: Normalize error
        throw err;
      }
    }
  }

  // That failed, let's try a NODE_SHIM
  const builtIn = NODE_CORE_SHIMS[bareModuleReference];

  if (builtIn) {
    const { name, pathname, spec } = parseBareModuleSpec(builtIn);

    if (!spec) {
      throw new InvariantViolation(
        `Found a node core shim '${builtIn}' for '${bareModuleReference}' that didn't include a version specifier`
      );
    }

    try {
      const resolvedSpec = resolveNpmPackageArg(name, spec, parentHref);

      return {
        name,
        pathname,
        resolvedSpec,
        spec,
      };
    } catch (err) {
      // TODO: Normalize error
      throw err;
    }
  }
}
