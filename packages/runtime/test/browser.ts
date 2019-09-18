import { resolve } from 'path';

import { expect } from '@hapi/code';
import { readFile } from 'fs-extra';
import { script } from '@hapi/lab';
import { Browser, launch } from 'puppeteer';

import { browser as browserMain, name } from '../package.json';

export const lab = script();

const { after, before, describe, it } = lab;

declare const Velcro: typeof import('../dist/dist-main');

describe(`${name} in the browser`, () => {
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
      const runtime = Velcro.createRuntime({
        injectGlobal: Velcro.injectGlobalFromUnpkg,
        resolveBareModule: Velcro.resolveBareModuleToUnpkg,
      });
      const inst = await runtime.import(spec);

      return Object.keys(inst);
    }, 'react@16');

    expect(result).to.contain('createElement');
  });

  it('will load @angular/core@7', { timeout: 10000 }, async () => {
    const page = await browser.newPage();

    await page.addScriptTag({ content: await codePromise });

    const result = await page.evaluate(async function(spec: string) {
      const runtime = Velcro.createRuntime({
        injectGlobal: Velcro.injectGlobalFromUnpkg,
        resolveBareModule: Velcro.resolveBareModuleToUnpkg,
      });
      const inst = await runtime.import(spec);

      return Object.keys(inst);
    }, '@angular/core@7');

    expect(result).to.contain(['Component', 'Directive', 'Input', 'Output', 'Pipe']);
  });

  it('will load bootstrap@4/dist/css/bootstrap.css as a css module using a loader', { timeout: 100000 }, async () => {
    const page = await browser.newPage();

    await page.addScriptTag({ content: await codePromise });

    const result = await page.evaluate(async function(spec: string) {
      const runtime = Velcro.createRuntime({
        injectGlobal: Velcro.injectGlobalFromUnpkg,
        resolveBareModule: Velcro.resolveBareModuleToUnpkg,
        rules: [
          {
            test: /\.css$/,
            use: [{ loader: 'style-loader' }, { loader: 'css-loader', options: { modules: true } }],
          },
        ],
      });
      const inst = await runtime.import(spec);

      return Object.keys(inst);
    }, 'bootstrap@4/dist/css/bootstrap.css');

    expect(result).to.contain(['btn', 'btn-sm']);
  });
});
