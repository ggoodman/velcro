import { Uri } from '@velcro/common';
import MagicString from 'magic-string';
import { DEFAULT_SHIM_GLOBALS } from './shims';
import { SourceModuleDependency } from './sourceModuleDependency';

export interface ParseOptions {
  globalModules: typeof DEFAULT_SHIM_GLOBALS;
  nodeEnv: string;
}

export type ParserFunction = (
  uri: Uri,
  code: string,
  options: ParseOptions
) => {
  code: MagicString;
  dependencies: SourceModuleDependency[];
};

export type CodeChange =
  | {
      type: 'appendRight';
      start: number;
      value: string;
    }
  | {
      type: 'remove';
      start: number;
      end: number;
    }
  | {
      type: 'overwrite';
      start: number;
      end: number;
      value: string;
    };

export enum SyntaxKind {
  JavaScript = 'JavaScript',
  JSON = 'JSON',
}
