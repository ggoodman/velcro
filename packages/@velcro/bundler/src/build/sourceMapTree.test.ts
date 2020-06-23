import { Uri } from '@velcro/common';
import { getLocator } from 'locate-character';
import MagicString from 'magic-string';
import { RawSourceMap, SourceMapConsumer } from 'source-map';
import { encode } from 'sourcemap-codec';
import { parse } from '../graph/commonjs';
import { Link, Source } from './sourceMapTree';

describe('SourceMapTree', () => {
  // Skipping while I figure out lifting high-res 'lower' source-map details into 'higher'
  // low-res source-maps.
  it.skip('will flatten a simple source-map', async () => {
    const source = new Source('style.css', 'h1 {\n  color: rebeccapurple;\n}\n');

    const escaped = escapeCss(new MagicString(source.content!));
    const escapedLink = new Link(escaped.generateDecodedMap(), [source]);
    console.log('escaped', (escapedLink.traceMappings() as any).mappings);

    const js = new MagicString(escaped.toString());
    js.prepend(`module.exports = '`);
    js.append(`';`);
    const jsLink = new Link(js.generateDecodedMap(), [escapedLink]);
    console.log('js', (jsLink.traceMappings() as any).mappings);

    const parsed = parse(Uri.file(source.filename), js.toString(), {
      globalModules: {},
      nodeEnv: '',
    });
    const parsedLink = new Link(parsed.code.generateDecodedMap(), [jsLink]);
    console.log('parsed', parsed.code.generateDecodedMap().mappings);

    const mappings = parsedLink.traceMappings();

    if (mappings instanceof Error) {
      throw mappings;
    }

    const consumer = await new SourceMapConsumer({
      ...mappings,
      mappings: encode(mappings.mappings),
      version: '3',
    } as RawSourceMap);
    const locator = getLocator(parsed.code.toString(), { offsetLine: 1 });

    const loc1 = locator('rebeccapurple');
    const pos1 = consumer.originalPositionFor(loc1);

    expect(pos1).toStrictEqual({
      source: 'memory:/index.js',
      line: 1,
      column: 12,
      name: null,
    });
  });
});

function escapeCss(magicString: MagicString) {
  const BACKSLASH = '\\'.charCodeAt(0);
  const SINGLE_QUOTE = "'".charCodeAt(0);
  const NL = '\n'.charCodeAt(0);
  const CR = '\r'.charCodeAt(0);

  let escaped = false;

  for (let i = 0; i < magicString.original.length; i++) {
    const char = magicString.original.charCodeAt(i);

    if (char === BACKSLASH) {
      escaped = !escaped;
      continue;
    }

    if (!escaped) {
      // Escape certain characters (if not already escaped)
      switch (char) {
        case CR:
        case NL:
          magicString.overwrite(i, i + 1, '\\n');
          break;
        case SINGLE_QUOTE:
          magicString.prependRight(i, '\\');
          break;
      }
    }

    escaped = false;
  }

  return magicString;
}
