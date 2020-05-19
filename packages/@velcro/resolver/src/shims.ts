import { version as nodeLibsVersion } from '@velcro/node-libs/package.json';
import { BareModuleSpec, parseBareModuleSpec } from './bareModules';

export const NODE_CORE_SHIMS: Record<string, BareModuleSpec | undefined> = Object.assign(
  Object.create(null),
  {
    string_decoder: parseBareModuleSpec('string_decoder@1.2.0'),
    punycode: parseBareModuleSpec('punycode@2.1.1'),
  }
);

for (const name of [
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
]) {
  NODE_CORE_SHIMS[name] = parseBareModuleSpec(
    `@velcro/node-libs@${nodeLibsVersion}/lib/${name}.js`
  )!;
}
