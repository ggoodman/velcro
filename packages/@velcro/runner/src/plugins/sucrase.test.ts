import { Uri } from '@velcro/common';
import { sucrasePlugin } from './sucrase';

describe('sucrasePlugin', () => {
  it('will transpile jsx', async () => {
    const plugin = sucrasePlugin({
      transforms: ['jsx'],
    });
    const result = await plugin.transform!(
      { nodeEnv: 'development' } as any,
      Uri.file('index.js'),
      `/** @jsx h */
       export default <h1>Hello world</h1>`
    );

    expect(result?.code).toMatchInlineSnapshot(`
      "\\"use strict\\";const _jsxFileName = \\"file:///index.js\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});/** @jsx h */
             exports. default = h('h1', {__self: this, __source: {fileName: _jsxFileName, lineNumber: 2}}, \\"Hello world\\" )"
    `);
  });
});
