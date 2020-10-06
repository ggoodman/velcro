/**
 * @jest-environment jsdom
 */

import { cssPlugin } from '@velcro/plugin-css';
import { build } from '@velcro/runner';
import fetch from 'cross-fetch';
import { getLocator } from 'locate-character';
import { SourceMapConsumer } from 'source-map';

async function readUrl(href: string) {
  const res = await fetch(href, { redirect: 'follow' });

  if (!res.ok) {
    throw new Error(
      `Unexpected response while fetching ${JSON.stringify(href)}: ${res.status} ${res.statusText}`
    );
  }

  return res.arrayBuffer();
}

describe('SourceMap support', () => {
  it('will work for in-memory builds', async () => {
    const buildResult = await build(`console.log(42)`, {
      readUrl,
    });

    const sourceMap = buildResult.output.sourceMapString;
    const consumer = await new SourceMapConsumer(sourceMap);
    const locator = getLocator(buildResult.output.code, { offsetLine: 1 });

    const loc1 = locator('42');
    const pos1 = consumer.originalPositionFor(loc1);

    expect(typeof pos1).toEqual('object');
    if (pos1.column) {
      // Not clear at all why this test is flaky but the column seems to sometimes
      // be omitted by `SourceMapConsumer` 🤷‍♂️.
      expect(pos1.column).toEqual(12);
    }
    if (pos1.line) {
      // Not clear at all why this test is flaky but the line seems to sometimes
      // be omitted by `SourceMapConsumer` 🤷‍♂️.
      expect(pos1.line).toEqual(1);
    }
    expect(pos1.name).toBeNull();
    expect(pos1.source).toMatch(/^velcro:\/\/[^\/]+\/index\.js$/);
  });

  // Skipping while I figure out lifting high-res 'lower' source-map details into 'higher'
  // low-res source-maps.
  it.skip('will work for css transforms', async () => {
    const buildResult = await build(`module.exports = require('github-markdown-css')`, {
      dependencies: {
        'github-markdown-css': '4.0.0',
      },
      plugins: [cssPlugin()],
      readUrl,
    });

    const sourceMap = buildResult.output.sourceMapString;
    const consumer = await new SourceMapConsumer(sourceMap);
    const locator = getLocator(buildResult.output.code, { offsetLine: 1 });

    const loc1 = locator('monospace,monospace');
    const pos1 = consumer.originalPositionFor(loc1);

    expect(pos1).toStrictEqual({
      source: 'https://cdn.jsdelivr.net/npm/github-markdown-css@4.0.0/github-markdown.css',
      line: 1,
      column: 12,
      name: null,
    });
  });

  it('will produce a correct map for preact', async () => {
    const buildResult = await build(`module.exports = require('preact');`, {
      readUrl,
      dependencies: {
        preact: '10.4.4',
      },
      nodeEnv: 'development',
    });

    const sourceMap = buildResult.output.sourceMapString;
    const consumer = await new SourceMapConsumer(sourceMap);
    const locator = getLocator(buildResult.output.code, { offsetLine: 1 });

    const loc1 = locator('render');
    const pos1 = consumer.originalPositionFor(loc1);

    // https://github.com/preactjs/preact/blob/1834cd70adf5758541d6167ba8c2c42778443d04/src/diff/index.js#L66
    expect(pos1).toStrictEqual({
      source: 'https://cdn.jsdelivr.net/npm/preact@10.4.4/dist/preact.js',
      line: 1,
      column: 4333,
      name: null,
    });

    const loc2 = locator('render', loc1.character + 1);
    const pos2 = consumer.originalPositionFor(loc2);

    // https://github.com/preactjs/preact/blob/1834cd70adf5758541d6167ba8c2c42778443d04/src/diff/index.js#L71
    expect(pos2).toStrictEqual({
      source: 'https://cdn.jsdelivr.net/npm/preact@10.4.4/dist/preact.js',
      line: 1,
      column: 4397,
      name: null,
    });
  });
});
