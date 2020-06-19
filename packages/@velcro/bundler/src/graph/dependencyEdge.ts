import { Uri } from '@velcro/common';
import { ResolverContext } from '@velcro/resolver';
import { SourceModuleDependency } from '../graph/sourceModuleDependency';

export interface DependencyEdge {
  dependency: SourceModuleDependency;
  fromUri: Uri;
  fromRootUri: Uri;
  toUri: Uri;
  toRootUri: Uri;
  visited: ResolverContext.Visit[];
}
