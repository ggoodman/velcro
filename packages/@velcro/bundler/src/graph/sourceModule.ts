import type { Uri } from '@velcro/common';
import type { ResolverContext } from '@velcro/resolver';
import type MagicString from 'magic-string';
import type { Link, Source } from '../build/sourceMapTree';
import type { SourceModuleDependency } from './sourceModuleDependency';

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
