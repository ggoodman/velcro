import { util, Resolver, PackageJson, ResolvedEntryKind, ResolverHost } from '@velcro/resolver';

import { Emitter, Event } from 'ts-primitives';
import { BareModuleSpec } from '@velcro/resolver-host-unpkg';

const HAS_D_TS_EXTENSION = /\.d\.ts$/;

enum PackageEntryKind {
  Directory = 'directory',
  File = 'file',
}

interface PackageDirectoryEntry {
  type: PackageEntryKind.Directory;
  path: string;
  files: PackageEntry[];
}

interface PackageFileEntry {
  type: PackageEntryKind.File;
  path: string;
}

interface TypingsFiles {
  [fileName: string]: string;
}

type PackageEntry = PackageDirectoryEntry | PackageFileEntry;

function getTypingsModuleSpec(pkgJson: { name: string; version?: string }): { name: string; range: string } {
  const typingsName = pkgJson.name.charAt(0) === '@' ? pkgJson.name.slice(1).replace('/', '__') : pkgJson.name;

  let typingsRange = '*';

  if (pkgJson.version) {
    const major = pkgJson.version.split('.')[0];
    typingsRange = `${major}.x`;
  }

  return {
    name: `@types/${typingsName}`,
    range: typingsRange,
  };
}

interface TypeFile {
  pathname: string;
  content: string;
}

export class TypeAcquirer {
  private _onTypeFile = new Emitter<TypeFile>();

  constructor(
    private readonly resolver: Resolver,
    private readonly resolveBareModule: (resolver: ResolverHost, spec: BareModuleSpec) => URL
  ) {}

  private _importAdjacentTypings(
    typingsFiles: TypingsFiles,
    pkgJson: PackageJson,
    parentPath: string
  ): Promise<boolean> {
    // console.log('_importAdjacentTypings', pkgJson.name, pkgJson.version, parentPath);
    const moduleRoot = util.join(parentPath, `node_modules/${pkgJson.name}/`);

    if (!pkgJson.name) {
      return Promise.resolve(false);
    }

    return this._listFiles(pkgJson.name, pkgJson.version).then(files => {
      let imported = false;
      const promises: Promise<void>[] = [];
      const normalizedMain = util.resolve('/', pkgJson.main || 'index.js');

      for (const pathname in files) {
        if (!(normalizedMain === pathname || HAS_D_TS_EXTENSION.test(pathname))) {
          continue;
        }

        promises.push(
          this.resolver.host
            .readFileContent(
              this.resolver,
              this.resolveBareModule(this.resolver.host, {
                name: pkgJson.name!,
                nameSpec: `${pkgJson.name}@${pkgJson.version}`,
                pathname,
                spec: pkgJson.version!,
              })
            )
            .then(
              // eslint-disable-next-line no-loop-func
              buf => {
                const contents = this.resolver.decoder.decode(buf);
                const filePath = util.join(moduleRoot, pathname);
                typingsFiles[filePath] = contents;

                this._onTypeFile.fire({
                  pathname: filePath,
                  content: contents,
                });

                if (normalizedMain !== pathname) {
                  imported = true;
                }
              },
              e => {
                console.warn(e);
              }
            )
        );
      }

      if (!promises.length) {
        return imported;
      }

      return Promise.all(promises).then(() => imported);
    });
  }

  // private async _importEmbeddedTypings(
  //   typingsFiles: TypingsFiles,
  //   pkgJson: PackageJsonWithTypings,
  //   parentPath: string
  // ) {
  //   let filesPromise: Promise<{ [fileName: string]: PackageFileEntry }> | undefined;
  //   const readFiles = () => {
  //     if (!filesPromise) {
  //       filesPromise = this._listFiles(pkgJson.name, pkgJson.version);
  //     }
  //     return filesPromise;
  //   };
  //   const visitTypingsFile = async (fileName: string) => {
  //     if (seen.has(fileName)) return;
  //     seen.add(fileName);
  //     console.log('visiting', fileName);
  //     // Load the contents and add it to the known models
  //     const sourceText = await this._readUnpkgFile(pkgJson.name, pkgJson.version, pkgJson.typings);
  //     console.log('addExtraLib', sourceText, fileName);
  //     typingsFiles[join(parentPath, fileName)] = sourceText;
  //     const sourceFile = typescript.createSourceFile(fileName, sourceText, typescript.ScriptTarget.Latest, true);
  //     const children: string[] = [];
  //     typescript.forEachChild(sourceFile, child => {
  //       if (typescript.isImportDeclaration(child) && typescript.isStringLiteral(child.moduleSpecifier)) {
  //         children.push(child.moduleSpecifier.text);
  //       } else if (
  //         typescript.isExportDeclaration(child) &&
  //         child.moduleSpecifier &&
  //         child.moduleSpecifier &&
  //         typescript.isStringLiteral(child.moduleSpecifier)
  //       ) {
  //         children.push(child.moduleSpecifier.text);
  //       }
  //     });
  //     // We will figure out dependencies outside this module by building the optimized npm
  //     // dependency tree
  //     const relativeChildren = children.filter(ref => ref.charAt(0) === '.');
  //     if (relativeChildren.length) {
  //       const currentDir = dirname(fileName);
  //       const files = await readFiles();
  //       await Promise.all(
  //         relativeChildren.map(ref => {
  //           const childPathReference = resolve(currentDir, ref);
  //           const childPath = resolveImportPath(files, childPathReference);
  //           if (childPath) {
  //             return visitTypingsFile(childPath);
  //           }
  //         })
  //       );
  //     }
  //   };
  //   const seen = new Set<string>();
  //   const typescript = await import('typescript');
  //   await visitTypingsFile(pkgJson.typings);
  // }

  private async _importTypingsFromDefinitelyTyped(
    files: TypingsFiles,
    pkgJson: PackageJson,
    parentPath: string
  ): Promise<void> {
    // console.log('_importTypingsFromDefinitelyTyped', pkgJson.name, pkgJson.version, parentPath);
    if (!pkgJson.name) {
      return undefined;
    }

    const typingsModuleSpec = getTypingsModuleSpec({ name: pkgJson.name, version: pkgJson.version });

    try {
      const pkgJson = await this._import(files, typingsModuleSpec.name, typingsModuleSpec.range, parentPath);

      if (pkgJson.dependencies) {
        for (const name in pkgJson.dependencies) {
          await this._import(files, name, pkgJson.dependencies[name], parentPath);
        }
      }
    } catch (e) {
      return undefined;
    }
  }

  private async _listFiles(
    name: string,
    version: string = 'latest'
  ): Promise<{ [pathname: string]: PackageFileEntry }> {
    const unresolvedUrl = await this.resolver.host.getCanonicalUrl(
      this.resolver,
      this.resolveBareModule(this.resolver.host, {
        name,
        spec: version,
        nameSpec: `${name}@${version}`,
        pathname: '/',
      })
    );
    const resolvedUrl = await this.resolver.host.getCanonicalUrl(this.resolver, unresolvedUrl);
    const entries: { [pathname: string]: PackageFileEntry } = {};
    const queue = [resolvedUrl];

    while (queue.length) {
      const next = queue.shift()!;
      const entriesAtPath = await this.resolver.host.listEntries(this.resolver, next);

      for (const entry of entriesAtPath) {
        if (entry.type === ResolvedEntryKind.Directory) {
          queue.push(entry.url);
        } else {
          const path = entry.url.href.slice(resolvedUrl.href.length - 1);
          entries[path] = { type: PackageEntryKind.File, path };
        }
      }
    }

    return entries;
  }

  private async _import(
    files: TypingsFiles,
    name: string,
    range: string,
    parentPath: string = ''
  ): Promise<PackageJson> {
    // console.log('_import', name, range, parentPath);

    const pkgJsonPathname = util.join(parentPath, 'node_modules', name, 'package.json');
    const bareModuleUrl = this.resolveBareModule(this.resolver.host, {
      name,
      spec: range,
      nameSpec: `${name}@${range}`,
      pathname: '/package.json',
    });
    const resolvedPkgJson = await this.resolver.readParentPackageJson(bareModuleUrl);

    if (!resolvedPkgJson) {
      throw new Error(`Unable to load package.json for ${name}@${range}`);
    }

    const pkgJsonText = JSON.stringify(resolvedPkgJson.packageJson);
    const resolvedName = resolvedPkgJson.packageJson.name || name;

    files[pkgJsonPathname] = pkgJsonText;

    this._onTypeFile.fire({
      pathname: pkgJsonPathname,
      content: pkgJsonText,
    });

    // if (isPackageJsonWithTypings(pkgJson)) {
    //   await this._importEmbeddedTypings(files, pkgJson, parentPath);
    // } else {
    try {
      const hasAdjacentTypings = await this._importAdjacentTypings(files, resolvedPkgJson.packageJson!, parentPath);

      // console.log('hasAdjacentTypings', hasAdjacentTypings);

      if (!hasAdjacentTypings && resolvedName.indexOf('@types/') !== 0) {
        await this._importTypingsFromDefinitelyTyped(files, resolvedPkgJson.packageJson, parentPath);
      }
    } catch (err) {
      console.error('error', err);
    }
    // }

    return resolvedPkgJson.packageJson;
  }

  get onTypeFile(): Event<TypeFile> {
    return this._onTypeFile.event;
  }

  async importTypesForSpec(name: string, range: string = 'latest', parentPath: string = ''): Promise<TypingsFiles> {
    const files: TypingsFiles = {};

    try {
      await this._import(files, name, range, parentPath);
    } catch (err) {
      console.warn(err, `Type acquisition failed for ${name}@${range}`);
    }

    return files;
  }

  async importTypesForSpecs(specs: { [name: string]: string }, parentPath: string = ''): Promise<TypingsFiles> {
    const promises = Object.keys(specs).map(name => this.importTypesForSpec(name, specs[name], parentPath));
    const importResults = promises.length ? await Promise.all(promises) : [];

    return importResults.reduce((files, result) => ({ ...files, ...result }), {} as TypingsFiles);
  }
}
