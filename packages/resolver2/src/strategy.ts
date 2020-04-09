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
  getCanonicalUrl(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): CanonicalizeResult | Thenable<CanonicalizeResult>;
  getRootUrl(
    this: ResolverStrategy,
    uri: Uri,
    ctx: ResolverContext
  ): RootUrlResult | Thenable<RootUrlResult>;
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
