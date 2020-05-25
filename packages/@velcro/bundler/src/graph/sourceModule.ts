import { Uri } from '@velcro/common';
import { ResolverContext } from '@velcro/resolver';
import MagicString from 'magic-string';
import { Link, Source } from '../build/sourceMapTree';
import { SourceModuleDependency } from './sourceModuleDependency';

export class SourceModule {
  constructor(
    readonly uri: Uri,
    readonly rootUri: Uri,
    readonly source: MagicString,
    readonly dependencies: Set<SourceModuleDependency>,
    readonly sourceMapsTree: Source | Link,
    readonly visits: ResolverContext.Visit[]
  ) {}

  get href() {
    return this.uri.toString();
  }

  get rootHref() {
    return this.rootUri.toString();
  }
}
