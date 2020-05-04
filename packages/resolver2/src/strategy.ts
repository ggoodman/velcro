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

export interface RootUrlResult {
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
    name: string,
    spec: string,
    path: string,
    ctx: ResolverContext
  ): BareModuleResult | Thenable<BareModuleResult>;
  getCanonicalUrl(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): CanonicalizeResult | Thenable<CanonicalizeResult>;
  getResolveRoot(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): ResolveRootResult | Thenable<ResolveRootResult>;
  getSettings(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): SettingsResult | Thenable<SettingsResult>;
  canResolve(this: ResolverStrategy, uri: Uri): boolean;
  listEntries(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): ListEntriesResult | Thenable<ListEntriesResult>;
  readFileContent(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): ReadFileContentResult | Thenable<ReadFileContentResult>;
}

export abstract class AbstractResolverStrategy implements ResolverStrategy {
  getCanonicalUrl(
    uri: Uri,
    _ctx: ResolverContext
  ): ReturnType<ResolverStrategy['getCanonicalUrl']> {
    return {
      uri,
    };
  }

  abstract canResolve(_uri: Uri): ReturnType<ResolverStrategy['canResolve']>;

  getSettings(_uri: Uri, ctx: ResolverContext): ReturnType<ResolverStrategy['getSettings']> {
    return {
      settings: ctx.settings,
    };
  }

  abstract getResolveRoot(
    uri: Uri,
    ctx: ResolverContext
  ): ReturnType<ResolverStrategy['getResolveRoot']>;
  abstract listEntries(uri: Uri, ctx: ResolverContext): ReturnType<ResolverStrategy['listEntries']>;
  abstract readFileContent(
    uri: Uri,
    ctx: ResolverContext
  ): ReturnType<ResolverStrategy['readFileContent']>;
}
