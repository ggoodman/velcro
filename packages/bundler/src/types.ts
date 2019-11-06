export type Awaitable<T> = T | PromiseLike<T>;

export interface DeferredExecutionModuleRecord {
  code: string;
  dependencies: Record<string, string>;
}

export interface DeferredExecutionManifest {
  aliases: Record<string, string>;
  entrypoints: Record<string, string>;
  modules: Record<string, DeferredExecutionModuleRecord>;
}

export interface ImmediateExecutionModuleRecord {
  dependencies: Record<string, string>;
  factory: ModuleFactory;
}

export interface ImmediateExecutionManifest {
  aliases: Record<string, string>;
  entrypoints: Record<string, string>;
  modules: Record<string, ImmediateExecutionModuleRecord>;
}

export type ModuleFactory = (
  this: any,
  module: { exports: any },
  exports: any,
  require: RequireFunction,
  __dirname: string,
  __pathname: string
) => void;

export type RequireFunction = (spec: string) => any;

export interface AcceptCallback {
  cb(): void;
}

export interface DisposeCallback {
  cb(): void;
}

export interface IModule {
  readonly id: string;
  readonly acceptCallbacks: ReadonlyArray<AcceptCallback>;
  readonly disposeCallbacks: ReadonlyArray<DisposeCallback>;
  readonly dependencies: ReadonlyArray<IModule>;
  readonly dependents: ReadonlyArray<IModule>;
  readonly require: RequireFunction;
}

export interface IRuntime {
  readonly root: IModule;

  alias(spec: string, href: string): void;
  dependency(fromHref: string, spec: string, toHref: string): void;
  get(id: string): IModule | undefined;
  init(manifest: ImmediateExecutionManifest, executeEntrypoints?: boolean): void;
  register(spec: string, factory: ModuleFactory): any;
  remove(spec: string): IModule | undefined;
  require(spec: string): any;
}

export interface RuntimeOptions {
  /**
   * Whether the listed entrypoints should be automatically invoked
   */
  executeEntrypoints?: boolean;

  runtime?: string;
}
