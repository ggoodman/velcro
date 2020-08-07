import type { Uri } from '@velcro/common';
import type { ResolverContext } from '@velcro/resolver';
import type { SourceModuleDependency } from '../graph/sourceModuleDependency';

export interface DependencyEdge {
  dependency: SourceModuleDependency;
  fromUri: Uri;
  fromRootUri: Uri;
  toUri: Uri;
  toRootUri: Uri;
  visited: ResolverContext.Visit[];
}
