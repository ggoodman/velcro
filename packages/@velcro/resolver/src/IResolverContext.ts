import type { PackageJson, PackageMainField, Thenable, Uri } from '@velcro/common';
import type { ResolverStrategy } from './strategy';

type MaybeThenable<T> = T | Thenable<T>;

type ResolveResult =
  | {
      found: false;
      uri: null;
      parentPackageJson?: { packageJson: PackageJson; uri: Uri };
    }
  | {
      found: true;
      uri: null;
      parentPackageJson?: { packageJson: PackageJson; uri: Uri };
      rootUri: Uri;
    }
  | {
      found: true;
      uri: Uri;
      parentPackageJson?: { packageJson: PackageJson; uri: Uri };
      rootUri: Uri;
    };

type ReadParentPackageJsonResult =
  | {
      found: true;
      packageJson: PackageJson;
      uri: Uri;
      visitedDirs: Uri[];
    }
  | {
      found: false;
      packageJson: null;
      uri: null;
    };

export interface GetCanonicalUrlResult {
  uri: Uri;
}

export interface GetResolveRootResult {
  uri: Uri;
}
export interface GetSettingsResult {
  debug?: boolean;
  extensions: string[];
  packageMain: PackageMainField[];
}

export interface GetUrlForBareModuleResult {
  found: boolean;
  uri: Uri | null;
}

export interface ListEntriesResult {
  entries: ResolverStrategy.Entry[];
}

export interface ReadFileContentResult {
  content: ArrayBuffer;
}

export interface IResolverContext {
  getCanonicalUrl(uri: Uri): MaybeThenable<GetCanonicalUrlResult>;
  getResolveRoot(uri: Uri): MaybeThenable<GetResolveRootResult>;
  getSettings(uri: Uri): MaybeThenable<GetSettingsResult>;
  getUrlForBareModule(): MaybeThenable<GetUrlForBareModuleResult>;
  listEntries(uri: Uri): MaybeThenable<ListEntriesResult>;
  readFileContent(uri: Uri): MaybeThenable<ReadFileContentResult>;
  readParentPackageJson(uri: Uri): MaybeThenable<ReadParentPackageJsonResult>;
}
