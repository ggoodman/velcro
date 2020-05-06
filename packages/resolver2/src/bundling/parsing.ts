import { ResolverContext } from '../context';
import { Uri } from '../uri';
import { DEFAULT_SHIM_GLOBALS, NODE_CORE_SHIMS } from './shims';
import { SourceModuleDependency } from './sourceModuleDependency';

export interface ParseOptions {
  environmentModules: typeof NODE_CORE_SHIMS;
  globalModules: typeof DEFAULT_SHIM_GLOBALS;
  nodeEnv: string;
}

export type ParserFunction = (
  ctx: ResolverContext,
  uri: Uri,
  content: ArrayBuffer,
  options: ParseOptions
) => {
  code: string;
  dependencies: SourceModuleDependency[];
  replacements: Replacement[];
  syntax: SyntaxKind;
};

export type Replacement = {
  start: number;
  end: number;
  replacement: string;
};

export enum SyntaxKind {
  JavaScript = 'JavaScript',
  JSON = 'JSON',
}
