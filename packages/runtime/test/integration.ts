import { resolve } from 'path';

import { expect } from 'code';
import { readFile } from 'fs-extra';
import { script } from 'lab';
import { Browser, launch } from 'puppeteer';

import { browser as browserMain, name } from '../package.json';

export const lab = script();

const { after, before, describe, it } = lab;

declare const VelcroRuntime: typeof import('../');

describe(name, () => {
  const codePromise = readFile(resolve(__dirname, '../', browserMain), 'utf8');

  let browser: Browser;

  before(async () => {
    browser = await launch();
  });

  after(async () => {
    await browser.close();
  });

  it('will load react@16', async () => {
    const page = await browser.newPage();

    await page.addScriptTag({ content: await codePromise });

    const result = await page.evaluate(async function(spec: string) {
      const runtime = VelcroRuntime.createRuntime();
      const inst = await runtime.import(spec);

      return Object.keys(inst);
    }, 'react@16');

    expect(result).to.contain('createElement');
  });
});
