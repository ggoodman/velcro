import MagicString from 'magic-string';
import { Uri } from '../uri';
import { SyntaxKind } from './parsing';
import { SourceModuleDependency } from './sourceModuleDependency';

export class SourceModule {
  constructor(
    readonly uri: Uri,
    readonly rootUri: Uri,
    readonly source: MagicString,
    readonly syntax: SyntaxKind,
    readonly dependencies: Set<SourceModuleDependency>
  ) {}

  get href() {
    return this.uri.toString();
  }

  get rootHref() {
    return this.rootUri.toString();
  }
}
