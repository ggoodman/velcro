export const version = '__VERSION__';
export type { VelcroRuntime } from '@velcro/runtime';
export type { Chunk } from './build/chunk';
export type { ChunkOutput } from './build/chunkOutput';
export * from './graph';
export type {
  Plugin,
  PluginLoadContext,
  PluginLoadResult,
  PluginTransformContext,
  PluginTransformResult,
} from './plugins';
