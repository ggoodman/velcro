import { ParseError } from '@velcro/common';
import { ParserFunction, SyntaxKind } from '../../parsing';

export const parse: ParserFunction = function parseJson(uri, code) {
  try {
    JSON.parse(code);

    return {
      code,
      dependencies: [],
      changes: [],
      syntax: SyntaxKind.JSON,
    };
  } catch (err) {
    throw new ParseError(uri, String(err));
  }
};
