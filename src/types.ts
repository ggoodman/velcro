interface PackageJsonWithNameAndVersion {
  name: string;
  version: string;
  [other: string]: unknown;
}
export function assertPackageJsonWithNameAndVersion(
  obj: unknown
): asserts obj is PackageJsonWithNameAndVersion {
  assertObjectLike(obj, 'PackageJson');

  if (typeof obj['name'] !== 'string') {
    throw new TypeError(
      'The "name" property of a PackageJson object must be a string'
    );
  }

  if (typeof obj['version'] !== 'string') {
    throw new TypeError(
      'The "version" property of a PackageJson object must be a string'
    );
  }
}

export interface PackageListing {
  default: string;
  files: Array<PackageListingDirectory | PackageListingFile>;
}
export interface PackageListingDirectory {
  type: 'directory';
  name: string;
  files?: Array<PackageListingDirectory | PackageListingFile>;
}
export interface PackageListingFile {
  type: 'file';
  name: string;
}
export function assertEntriesListing(
  obj: unknown
): asserts obj is PackageListing {
  assertObjectLike(obj, 'PackageListing');

  const files = obj['files'];
  if (!Array.isArray(files)) {
    throw new TypeError(
      `The .files property of a PackageListing must be an array`
    );
  }

  for (const idx in files) {
    assertPackageListingEntry(files[idx], `.files[${idx}]`);
  }
}

export function assertPackageListingEntry(
  obj: unknown,
  path: string
): asserts obj is PackageListingDirectory | PackageListingFile {
  assertObjectLike(obj, path);

  const name = obj['name'];
  if (typeof name !== 'string') {
    throw new TypeError(`The .name property must be a string at ${path}`);
  }

  switch (obj['type']) {
    case 'directory': {
      const files = obj['files'];
      if (!Array.isArray(files)) {
        throw new TypeError(
          `The .files property of a PackageListing entry must be an array at ${path}`
        );
      }

      for (const idx in files) {
        assertPackageListingEntry(files[idx], `${path}.files[${idx}]`);
      }
      break;
    }
    case 'file': {
      break;
    }
    default: {
      throw new TypeError(
        `Unexpected .type property of a PackageListing entry at ${path}`
      );
    }
  }
}

interface ObjectLike {
  [name: string]: unknown;
}

export function assertObjectLike(
  obj: unknown,
  kindName: string
): asserts obj is ObjectLike {
  if (obj == null || typeof obj !== 'object') {
    throw TypeError(`${kindName} variables must be objects`);
  }
}
