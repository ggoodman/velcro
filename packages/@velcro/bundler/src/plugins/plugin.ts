import type { CancellationToken, Uri } from '@velcro/common';
import type { Resolver, ResolverContext } from '@velcro/resolver';
import type MagicString from 'magic-string';
import type { SourceMapSegment } from 'magic-string';
import type { SourceModule, SourceModuleDependency } from '../graph';

type MaybeThenable<T> = T | PromiseLike<T>;

export type RequireFn = <T extends { [moduleName: string]: string }>(
  modules: T
) => Promise<{ [K in keyof T]: unknown }>;

export interface Plugin {
  name: string;
  load?(ctx: PluginLoadContext, id: string): MaybeThenable<PluginLoadResult | undefined>;
  resolveDependency?(
    ctx: PluginResolveDependencyContext,
    dependency: SourceModuleDependency,
    fromModule: SourceModule
  ): MaybeThenable<PluginResolveDependencyResult | undefined>;
  resolveEntrypoint?(
    ctx: PluginResolveEntrypointContext,
    uri: Uri
  ): MaybeThenable<PluginResolveEntrypointResult | undefined>;
  transform?(
    ctx: PluginTransformContext,
    id: Uri,
    code: string
  ): MaybeThenable<PluginTransformResult | undefined>;
}

export interface PluginLoadContext {
  nodeEnv: string;
  resolver: Resolver;
  token: CancellationToken;
}

export type PluginLoadResult = {
  code: string;
  visited?: ResolverContext.Visit[];
};

export interface PluginResolveDependencyContext {
  nodeEnv: string;
  resolver: Resolver;
  token: CancellationToken;
}

export type PluginResolveDependencyResult = {
  uri: Uri;
  rootUri: Uri;
  visited?: ResolverContext.Visit[];
};

export interface PluginResolveEntrypointContext {
  nodeEnv: string;
  resolver: Resolver;
  token: CancellationToken;
}

export type PluginResolveEntrypointResult = {
  uri: Uri;
  rootUri: Uri;
  visited?: ResolverContext.Visit[];
};

export interface PluginTransformContext {
  nodeEnv: string;
  resolver: Resolver;
  token: CancellationToken;

  createMagicString(): MagicString;
  // require: RequireFn;
}

export type PluginTransformResult = {
  code: string;
  sourceMap?: {
    mappings: SourceMapSegment[][] | string;
    names: string[];
  };
  visited?: ResolverContext.Visit[];
};
