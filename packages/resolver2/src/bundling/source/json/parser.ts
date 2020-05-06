import { ParseError } from '../../../error';
import { ParserFunction, SyntaxKind } from '../../parsing';

export const parse: ParserFunction = function parseJson(ctx, uri, content) {
  try {
    const code = ctx.decoder.decode(content);
    JSON.parse(code);

    return {
      code,
      dependencies: [],
      replacements: [],
      syntax: SyntaxKind.JSON,
    };
  } catch (err) {
    throw new ParseError(uri, String(err));
  }
};
