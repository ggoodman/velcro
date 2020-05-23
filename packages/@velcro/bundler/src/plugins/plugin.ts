import { Thenable, Uri } from '@velcro/common';
import { ResolverContext } from '@velcro/resolver';
import MagicString from 'magic-string';
import { ISourceMap } from '../build/sourceMap';
import { SourceModule, SourceModuleDependency } from '../graph';

type MaybeThenable<T> = T | Thenable<T>;

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

interface PluginContext extends ResolverContext {}

export interface PluginLoadContext extends PluginContext {}

export type PluginLoadResult = {
  code: string;
  visited?: ResolverContext.Visit[];
};

export interface PluginResolveDependencyContext extends PluginContext {}

export type PluginResolveDependencyResult = {
  uri: Uri;
  rootUri: Uri;
  visited?: ResolverContext.Visit[];
};

export interface PluginResolveEntrypointContext extends PluginContext {}

export type PluginResolveEntrypointResult = {
  uri: Uri;
  rootUri: Uri;
  visited?: ResolverContext.Visit[];
};

export interface PluginTransformContext extends PluginContext {
  readonly magicString: MagicString;
}

export type PluginTransformResult = {
  code: string;
  sourceMaps?: ISourceMap[];
  visited?: ResolverContext.Visit[];
};
