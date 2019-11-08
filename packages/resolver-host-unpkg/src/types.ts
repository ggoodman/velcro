import { ResolvedEntryKind } from '@velcro/resolver';

export type CustomFetch = (
  url: string,
  options?: Pick<RequestInit, 'redirect' | 'signal' | 'mode'>
) => Promise<Pick<Response, 'arrayBuffer' | 'json' | 'ok' | 'status'>>;

export type BareModuleSpec = {
  nameSpec: string;
  name: string;
  spec: string;
  pathname: string;
};

export type Spec = {
  spec: string;
  name: string;
  version: string;
  pathname: string;
};

export type Directory = {
  type: ResolvedEntryKind.Directory;
  path: string;
  files?: ReadonlyArray<Entry>;
};
export type File = {
  type: ResolvedEntryKind.File;
  path: string;
};
export type Entry = Directory | File;

export function isValidEntry(entry: unknown): entry is Entry {
  if (!entry || typeof entry !== 'object') return false;

  return isValidFile(entry) || isValidDirectory(entry);
}

export function isValidDirectory(entry: unknown): entry is Directory {
  return (
    typeof entry === 'object' &&
    entry &&
    (entry as any).type === ResolvedEntryKind.Directory &&
    typeof (entry as any).path === 'string' &&
    (entry as any).path &&
    (typeof (entry as any).files === 'undefined' ||
      (Array.isArray((entry as any).files) && (entry as any).files.every(isValidEntry)))
  );
}

export function isValidFile(entry: unknown): entry is File {
  return (
    typeof entry === 'object' &&
    entry &&
    (entry as any).type === ResolvedEntryKind.File &&
    typeof (entry as any).path === 'string' &&
    (entry as any).path
  );
}
