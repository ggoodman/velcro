import { ResolvedEntryKind } from '@velcro/resolver';
import * as t from 'io-ts';

export type customFetch = (
  url: string,
  options?: Pick<RequestInit, 'redirect'>
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

export const File = t.type({
  type: t.literal(ResolvedEntryKind.File),
  path: t.string,
});
export type File = t.TypeOf<typeof File>;

export const Directory = t.recursion<Directory>('Directory', self =>
  t.intersection([
    t.type({
      type: t.literal(ResolvedEntryKind.Directory),
      path: t.string,
    }),
    t.partial({
      files: t.array(t.union([File, self])),
    }),
  ])
);
export type Directory = {
  type: ResolvedEntryKind.Directory;
  path: string;
  files?: (Directory | File)[];
};

export const PackageJson = t.intersection([
  t.type({
    name: t.string,
    version: t.string,
  }),
  t.partial({
    dependencies: t.record(t.string, t.string),
    devDependencies: t.record(t.string, t.string),
    main: t.string,
    peerDependencies: t.record(t.string, t.string),
  }),
]);
export type PackageJson = t.TypeOf<typeof PackageJson>;

export const Entry = t.taggedUnion('type', [Directory, File]);
export type Entry = t.TypeOf<typeof Entry>;
