import { Visit } from '../context';
import { SourceModuleDependency } from '../graph/sourceModuleDependency';
import { Uri } from '../uri';

export interface DependencyEdge {
  dependency: SourceModuleDependency;
  fromUri: Uri;
  toUri: Uri;
  visited: Visit[];
}
