import type { ModuleReference } from './references';

export class PackageFileListing {
  public readonly entries: ReadonlyArray<PackageEntry>;

  constructor(entries: Array<PackageEntry>) {
    this.entries = entries;
  }
}

export type PackageEntry = PackageDirectory | PackageFile;

export interface PackageDirectory {
  readonly type: 'directory';
  readonly ref: ModuleReference;
  readonly entries: ReadonlyArray<PackageEntry>;
}

export interface PackageFile {
  readonly type: 'file';
  readonly ref: ModuleReference;
}
