import { Thenable } from 'ts-primitives';
import { ResolverContext } from './context';
import { Settings } from './settings';
import { Uri } from './uri';

export enum ResolvedEntryKind {
  File = 'file',
  Directory = 'directory',
}

export interface ResolvedEntry<TKind extends ResolvedEntryKind = ResolvedEntryKind> {
  uri: Uri;
  type: TKind;
}

export type BareModuleResult = {
  found: boolean;
  uri: Uri | null;
};

export interface CanonicalizeResult {
  uri: Uri;
}

export interface ResolveRootResult {
  uri: Uri;
}

export interface SettingsResult {
  settings: Settings;
}

export interface ListEntriesResult {
  entries: ResolvedEntry[];
}

export interface ReadFileContentResult {
  content: ArrayBuffer;
}

export interface ResolverStrategy {
  getUrlForBareModule?(
    this: ResolverStrategy,
    ctx: ResolverContext,
    name: string,
    spec: string,
    path: string
  ): BareModuleResult | Thenable<BareModuleResult>;
  getCanonicalUrl(
    this: ResolverStrategy,
    ctx: ResolverContext,
    uri: Uri
  ): CanonicalizeResult | Thenable<CanonicalizeResult>;
  getResolveRoot(
    this: ResolverStrategy,
    ctx: ResolverContext,
    uri: Uri
  ): ResolveRootResult | Thenable<ResolveRootResult>;
  getSettings(
    this: ResolverStrategy,
    ctx: ResolverContext,
    uri: Uri
  ): SettingsResult | Thenable<SettingsResult>;
  canResolve(this: ResolverStrategy, ctx: ResolverContext, uri: Uri): boolean;
  listEntries(
    this: ResolverStrategy,
    ctx: ResolverContext,
    uri: Uri
  ): ListEntriesResult | Thenable<ListEntriesResult>;
  readFileContent(
    this: ResolverStrategy,
    ctx: ResolverContext,
    uri: Uri
  ): ReadFileContentResult | Thenable<ReadFileContentResult>;
}

export abstract class AbstractResolverStrategy implements ResolverStrategy {
  getCanonicalUrl(
    _ctx: ResolverContext,
    uri: Uri
  ): ReturnType<ResolverStrategy['getCanonicalUrl']> {
    return {
      uri,
    };
  }

  abstract canResolve(ctx: ResolverContext, _uri: Uri): ReturnType<ResolverStrategy['canResolve']>;

  getSettings(ctx: ResolverContext, _uri: Uri): ReturnType<ResolverStrategy['getSettings']> {
    return {
      settings: ctx.settings,
    };
  }

  abstract getResolveRoot(
    ctx: ResolverContext,
    uri: Uri
  ): ReturnType<ResolverStrategy['getResolveRoot']>;
  abstract listEntries(ctx: ResolverContext, uri: Uri): ReturnType<ResolverStrategy['listEntries']>;
  abstract readFileContent(
    ctx: ResolverContext,
    uri: Uri
  ): ReturnType<ResolverStrategy['readFileContent']>;
}
