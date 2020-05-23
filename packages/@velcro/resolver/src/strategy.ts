import type { Thenable, Uri } from '@velcro/common';
import type { ResolverContext } from './context';
import type { Resolver } from './resolver';

type MaybeThenable<T> = T | Thenable<T>;

export interface ResolverStrategy {
  /**
   * Produce a url given the components of a bare module specifier.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param name The name of a bare module
   * @param spec The optional `@version` of a bare module specifier
   * @param path The optional path at the end of the bare module specifier
   */
  getUrlForBareModule?(
    ctx: ResolverContext,
    name: string,
    spec: string,
    path: string
  ): MaybeThenable<ResolverStrategy.BareModuleResult>;

  /**
   * Determine the canonical uri for a given uri.
   *
   * For example, you might consider symlink targets their canonicalized path or you might
   * consider the canonicalized path of https://unpkg.com/react to be
   * https://unpkg.com/react@16.13.1/index.js.
   *
   * Dealing only in canonical uris means that anything produced from those can be cached.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri to canonicalize
   */
  getCanonicalUrl(
    ctx: ResolverContext,
    uri: Uri
  ): MaybeThenable<ResolverStrategy.CanonicalizeResult>;

  /**
   * Get the logical resolve root for a given uri.
   *
   * For example, a filesystem-based strategy might consider the root to be `file:///`. Or,
   * if it was scoped to /home/filearts, the root might be `file:///home/filearts/`.
   *
   * Any uri that is not a 'child' of the resolve root should be considered out of scope for a given
   * strategy.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri for which the logical resolve root uri should be found
   */
  getResolveRoot(ctx: ResolverContext, uri: Uri): MaybeThenable<ResolverStrategy.ResolveRootResult>;

  /**
   * Get the settings for a given uri
   *
   * This indirection allows resolver strategies to have per-strategy or even per-uri settings.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri for which to load settings
   */
  getSettings(ctx: ResolverContext, uri: Uri): MaybeThenable<ResolverStrategy.SettingsResult>;

  /**
   * Produce a list of resolved entries that are direct children of the given uri.
   *
   * This is the moral equivalent to something like non-recursive `fs.readdir()`. It is only
   * designed to show files and folders (for now).
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri at which to list entries
   */
  listEntries(ctx: ResolverContext, uri: Uri): MaybeThenable<ResolverStrategy.ListEntriesResult>;

  /**
   * Read the content at the uri as an `ArrayBuffer`
   *
   * ArrayBuffers are the lowest-common-denominator across the web and node and can easily be
   * decoded with standard web apis like `StringDecoder`. In Node.js, `Buffer` objects are also
   * `ArrayBuffer`s, allowing the tooling to be built on that primitive.
   *
   * This is helpful for the understanding that not all uris are expected to produce meaningful
   * text representations.
   *
   * @param ctx A `ResolverContext` that should be used for making calls to other strategy methods
   * @param uri The uri at which to read the content
   */
  readFileContent(
    ctx: ResolverContext,
    uri: Uri
  ): MaybeThenable<ResolverStrategy.ReadFileContentResult>;
}

export interface ResolverStrategyWithRoot extends ResolverStrategy {
  /**
   * The root uri of the strategy.
   *
   * A common parent to all uris that this strategy can handle.
   *
   * This may sometimes be the same value as would be returned by `getResolveRoot` but will
   * sometimes be a parent of that. Take, for example Unpkg; there, we may want to express
   * that a strategy should 'own' all uris under https://unpkg.com/ even though the resolve
   * root for https://unpkg.com/react@16.13.1/index.js will actually be
   * https://unpkg.com/react@16.13.1/.
   *
   * Notably, the `CompoundResolverStrategy` requires all child strategies implement the
   * `ResolverStrategyWithRoot` interface because it dispatches operations on different
   * uris according to each strategy's `rootUri`.
   */
  rootUri: Uri;
}

export namespace ResolverStrategy {
  export enum EntryKind {
    File = 'file',
    Directory = 'directory',
  }

  export interface Entry<TKind extends EntryKind = EntryKind> {
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
    settings: Resolver.Settings;
  }

  export interface ListEntriesResult {
    entries: Entry[];
  }

  export interface ReadFileContentResult {
    content: ArrayBuffer;
  }
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

  getSettings(ctx: ResolverContext, _uri: Uri): ReturnType<ResolverStrategy['getSettings']> {
    return {
      settings: ctx.settings,
    };
  }

  /**
   * Create a new ResolverStrategy having one or more methods overridden.
   *
   * You might use this if you want to override specific behaviour of another strategy without
   * wanting to re-implement the whole strategy.
   *
   * If you need to invoke an overridden method, the overridden strategy will be available
   * on `this.parent`.
   *
   * @param overrides A map of ResolverStrategy methods that you would like to override
   */
  withOverrides(
    overrides: {
      [TMethodName in keyof ResolverStrategy]?: ResolverStrategy[TMethodName];
    }
  ): ResolverStrategy {
    const strategy = { ...overrides, parent: this };

    return Object.setPrototypeOf(Object.assign(Object.create(null), strategy), this);
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

export abstract class AbstractResolverStrategyWithRoot extends AbstractResolverStrategy
  implements ResolverStrategyWithRoot {
  constructor(readonly rootUri: Uri) {
    super();
  }
}
