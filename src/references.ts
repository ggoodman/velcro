import type { ResolverCdn } from './cdn';
import { dirname, resolve } from 'node:path';

export interface ModuleReference<TCanonicalized extends boolean = boolean> {
  readonly isCanonicalized: TCanonicalized;
  readonly url: Readonly<URL>;
  readonly name: string;
  readonly spec: string;
  readonly path: string;

  canonicalizedWith(options: {
    name?: string;
    spec?: string;
    path?: string;
  }): ModuleReference<true>;

  with(options: {
    name?: string;
    spec?: string;
    path?: string;
  }): ModuleReference<TCanonicalized>;

  withRelativePath(relativePath: string): ModuleReference<TCanonicalized>;
}

export function isCanonicalizedModuleReference(
  ref: ModuleReference
): ref is CanonicalizedModuleReference {
  return ref instanceof ModuleReferenceImpl && ref.isCanonicalized;
}

export interface CanonicalizedModuleReference extends ModuleReference<true> {}

export interface FloatingModuleReference extends ModuleReference<false> {}

export class ModuleReferenceImpl<TCanonicalized extends boolean = boolean>
  implements ModuleReference<TCanonicalized>
{
  private readonly cdn: ResolverCdn;
  public readonly name: string;
  public readonly spec: string;
  public readonly path: string;
  public readonly isCanonicalized: TCanonicalized;

  constructor(
    cdn: ResolverCdn,
    name: string,
    spec: string,
    path: string,
    isCanonicalized: TCanonicalized
  ) {
    this.cdn = cdn;
    this.name = name;
    this.spec = spec;
    this.path = path === '' || path.startsWith('/') ? path : `/${path}`;
    this.isCanonicalized = isCanonicalized;
  }

  get url(): URL {
    return this.cdn.urlForBareModule(this.name, this.spec, this.path);
  }

  canonicalizedWith({
    name,
    spec,
    path,
  }: {
    name?: string | undefined;
    spec?: string | undefined;
    path?: string | undefined;
  }): CanonicalizedModuleReference {
    return new ModuleReferenceImpl(
      this.cdn,
      name ?? this.name,
      spec ?? this.spec,
      path ?? this.path,
      true
    );
  }

  with({
    name,
    spec,
    path,
  }: {
    name?: string | undefined;
    spec?: string | undefined;
    path?: string | undefined;
  }): ModuleReference<TCanonicalized> {
    return new ModuleReferenceImpl(
      this.cdn,
      name ?? this.name,
      spec ?? this.spec,
      path ?? this.path,
      this.isCanonicalized
    );
  }

  withRelativePath(relativePath: string): ModuleReference<TCanonicalized> {
    return this.with({
      path: resolve(dirname(this.path), relativePath),
    });
  }
}
