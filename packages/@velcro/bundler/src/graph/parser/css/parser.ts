import { ParserFunction, SyntaxKind } from '../../parsing';
import { SourceModuleDependencyKind } from '../../sourceModuleDependency';

const urlRx = /^\s*@import\s+(?:url\((['"]?)([^)\1]+)\1\)|(['"])([^\3]+?)\3)/gm;

export const parse: ParserFunction = function parseJson(_uri, code) {
  const result: ReturnType<ParserFunction> = {
    code,
    dependencies: [],
    changes: [],
    syntax: SyntaxKind.CSS,
  };

  for (let match = urlRx.exec(code); match !== null; match = urlRx.exec(code)) {
    result.dependencies.push({
      kind: SourceModuleDependencyKind.CssImport,
      locations: [],
      options: {},
      spec: match[2] || match[4],
    });
  }

  return result;
};
