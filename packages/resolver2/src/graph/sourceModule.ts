import MagicString from 'magic-string';
import { getSourceMappingUrl } from '../build/sourceMap';
import { Uri } from '../uri';
import { ParentPackageJson } from './parentPackageJson';
import { SyntaxKind } from './parsing';
import { SourceModuleDependency } from './sourceModuleDependency';

export class SourceModule {
  sourceMappingUrl: string;

  constructor(
    readonly uri: Uri,
    readonly rootUri: Uri,
    readonly parentPackageJson: ParentPackageJson | undefined,
    readonly source: MagicString,
    readonly syntax: SyntaxKind,
    readonly dependencies: Set<SourceModuleDependency>
  ) {
    this.sourceMappingUrl = getSourceMappingUrl(source.original);
  }

  get href() {
    return this.uri.toString();
  }

  get rootHref() {
    return this.rootUri.toString();
  }
}
