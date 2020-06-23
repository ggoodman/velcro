export const version = '__VERSION__';
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
export type { VelcroRuntime } from './runtime';
