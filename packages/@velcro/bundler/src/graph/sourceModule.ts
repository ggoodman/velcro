import { Uri } from '@velcro/common';
import { ResolverContext } from '@velcro/resolver/src';
import MagicString from 'magic-string';
import { ISourceMap } from '../build/sourceMap';
import { SourceModuleDependency } from './sourceModuleDependency';

export class SourceModule {
  constructor(
    readonly uri: Uri,
    readonly rootUri: Uri,
    readonly source: MagicString,
    readonly dependencies: Set<SourceModuleDependency>,
    readonly sourceMaps: ISourceMap[],
    readonly visits: ResolverContext.Visit[]
  ) {}

  get href() {
    return this.uri.toString();
  }

  get rootHref() {
    return this.rootUri.toString();
  }
}
