export type PackageMainField = 'browser' | 'module' | 'jsnext:main' | 'main';

export enum ResolvedEntryKind {
  Directory = 'directory',
  File = 'file',
}

export type ResolvedEntry = {
  url: URL;
  type: ResolvedEntryKind;
};
