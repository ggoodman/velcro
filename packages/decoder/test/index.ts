import { resolve } from 'path';

import { expect } from 'code';
import { readFile } from 'fs-extra';
import { script, Flags } from 'lab';
import { Browser, launch } from 'puppeteer';

import { browser as browserMain, name } from '../package.json';

export const lab = script();

const { after, before, describe, it } = lab;

declare const VelcroDecoder: typeof import('../');

describe(name, () => {
  const codePromise = readFile(resolve(__dirname, '../', browserMain), 'utf8');

  let browser: Browser;

  before(async () => {
    browser = await launch();
  });

  after(async () => {
    await browser.close();
  });

  it('will decode an Uint8Array', async (flags: Flags) => {
    const page = await browser.newPage();
    const string = 'hello';
    const buf = Buffer.from(string);
    const ab = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    flags.onCleanup = async () => page.close();

    await page.addScriptTag({ content: await codePromise });

    const result = await page.evaluate(function(bytes: number[]) {
      const decoder = new VelcroDecoder.Decoder();
      const ab = new Uint8Array(bytes).buffer;

      return decoder.decode(ab);
    }, Array.from(ab));

    expect(result).to.equal(string);
  });
});
