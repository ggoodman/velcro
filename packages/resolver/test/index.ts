import { resolve } from 'path';

import { expect } from 'code';
import { readFile } from 'fs-extra';
import { script } from 'lab';
import { Browser, launch } from 'puppeteer';

import { browser as browserMain, name } from '../package.json';

export const lab = script();

const { after, before, describe, it } = lab;

declare const Velcro: typeof import('../');

describe(name, () => {
  const codePromise = readFile(resolve(__dirname, '../', browserMain), 'utf8');

  let browser: Browser;

  before(async () => {
    browser = await launch();
  });

  after(async () => {
    await browser.close();
  });

  it('will expose Velcro as a UMD', async () => {
    const page = await browser.newPage();

    await page.addScriptTag({ content: await codePromise });

    const result = await page.evaluate(async function() {
      return typeof Velcro.Resolver;
    });

    expect(result).to.equal('function');
  });
});
