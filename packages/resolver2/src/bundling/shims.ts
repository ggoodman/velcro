import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { parseBareModuleSpec, BareModuleSpec } from './bareModules';

export const DEFAULT_SHIM_GLOBALS: Record<string, { spec: string; export?: string } | undefined> = {
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

export const NODE_CORE_SHIMS = {
  ...[
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
      Object.assign(shims, {
        [coreLibName]: parseBareModuleSpec(
          `@velcro/node-libs@${nodeLibsVersion}/lib/${coreLibName}.js`
        ),
      }),
    {} as Record<string, BareModuleSpec | undefined>
  ),
  string_decoder: parseBareModuleSpec('string_decoder@1.2.0'),
  punycode: parseBareModuleSpec('punycode@2.1.1'),
} as Record<string, BareModuleSpec | undefined>;
