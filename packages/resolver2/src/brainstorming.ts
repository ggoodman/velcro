// import { Uri } from './uri';
// import { CancellationToken } from 'ts-primitives';
// import { PackageJson } from './packageJson';

// type JsonPrimitive = boolean | number | string | null;
// type Json = JsonPrimitive | Json[] | { [key: string]: Json };
// type MaybePromise<T> = T | PromiseLike<T>;

// export interface Decoder {
//   decode(data: BufferSource): string;
//   decodeAsJson(data: BufferSource | string): Json;
//   decodeAsPackageJson(data: BufferSource | string): PackageJson;
// }

// export interface Resolver {
//   createSession(): ResolverSession;
// }

// export interface ResolverSession {
//   readonly cancellationToken: CancellationToken;
//   readonly decoder: Decoder;

//   readFileContent(uri: string | Uri, options?: ReadFileContentOptions): Promise<ArrayBuffer>;
//   readParentPackageJson(
//     uri: string | Uri,
//     options?: ReadParentPackageJsonOptions
//   ): Promise<PackageJson>;
//   resolve(spec: string, fromUri?: string | Uri, options?: ResolveOptions): Promise<ResolveResult>;
// }

// export interface ResolverHostContext {
//   readonly cancellationToken: CancellationToken;
//   readonly decoder: Decoder;
//   readonly path: ReadonlyArray<string>;

//   getCanonicalUrl(uri: Uri): MaybePromise<ResolverHostContext.CanonicalUrlResult>;
//   getRootUrl(uri: Uri): MaybePromise<RootUrlResult>;
//   listEntriesAtUrl(uri: Uri): MaybePromise<ListEntriesAtUrlResult>;
//   readContentAtUrl(uri: Uri): MaybePromise<ReadContentAtUrlResult>;

//   withPath(pathSegment: string): ResolverHostContext;
// }

// export namespace ResolverHostContext {
//   export interface CanonicalUrlResult {}
// }

// export interface ResolverHost {
//   getCanonicalUrl(ctx: ResolverHostContext, uri: Uri): MaybePromise<CanonicalUrlResult>;
//   getRootUrl(ctx: ResolverHostContext, uri: Uri): MaybePromise<RootUrlResult>;
//   getResolveRootUrl(ctx: ResolverHostContext, uri: Uri): MaybePromise<ResolveRootUrlResult>;
//   getSettingsForUrl(ctx: ResolverHostContext, uri: Uri): MaybePromise<SettingsForUrlResult>;
//   listEntriesAtUrl(ctx: ResolverHostContext, uri: Uri): MaybePromise<ListEntriesAtUrlResult>;
//   readContentAtUrl(ctx: ResolverHostContext, uri: Uri): MaybePromise<ReadContentAtUrlResult>;
// }
