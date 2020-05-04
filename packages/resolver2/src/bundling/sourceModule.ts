import { Uri } from '../uri';
import MagicString from 'magic-string';
import { SourceModuleDependency } from './sourceModuleDependency';

export class SourceModule {
  readonly resolvedDependencies = new Map<SourceModuleDependency, Uri>();

  constructor(
    readonly uri: Uri,
    readonly rootUri: Uri,
    readonly source: MagicString,
    readonly dependencies: Set<SourceModuleDependency>
  ) {}

  get href() {
    return this.uri.toString();
  }

  setUriForDependency(dependency: SourceModuleDependency, uri: Uri) {
    if (!this.dependencies.has(dependency)) {
      throw new Error(`WAT?`);
    }

    this.resolvedDependencies.set(dependency, uri);
  }
}
