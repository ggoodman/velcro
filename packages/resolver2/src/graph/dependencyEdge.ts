import { SourceModuleDependency } from '../bundling/sourceModuleDependency';
import { Visit } from '../context';
import { Uri } from '../uri';

export interface DependencyEdge {
  dependency: SourceModuleDependency;
  fromUri: Uri;
  toUri: Uri;
  visited: Visit[];
}
