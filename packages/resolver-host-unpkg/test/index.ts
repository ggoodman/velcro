import { resolve } from 'path';

import { expect } from 'code';
import { readFile } from 'fs-extra';
import { script } from 'lab';
import { Browser, launch } from 'puppeteer';

import { browser as browserMain, name } from '../package.json';

export const lab = script();

const { after, before, describe, it } = lab;

declare const Velcro: typeof import('../') & typeof import('@velcro/resolver');

describe(name, () => {
  const codePromises = Promise.all([
    readFile(resolve(__dirname, '../', browserMain), 'utf8'),
    readFile(resolve(__dirname, '../node_modules/@velcro/resolver', browserMain), 'utf8'),
  ]);

  let browser: Browser;

  before(async () => {
    browser = await launch();
  });

  after(async () => {
    await browser.close();
  });

  it('will resolve a module entrypoint', async () => {
    const page = await browser.newPage();
    const scripts = await codePromises;

    await Promise.all(scripts.map(content => page.addScriptTag({ content })));

    const result = await page.evaluate(async function(href: string) {
      const host = new Velcro.ResolverHostUnpkg();
      const resolver = new Velcro.Resolver(host);
      const resolved = await resolver.resolve(href);

      return resolved ? resolved.href : null;
    }, 'https://unpkg.com/webtask-test-module-1');

    expect(result).to.equal('https://unpkg.com/webtask-test-module-1@2.0.0/index.js');
  });

  it('will resolve a module entrypoint with partial version hints', async () => {
    const page = await browser.newPage();
    const scripts = await codePromises;

    await Promise.all(scripts.map(content => page.addScriptTag({ content })));

    const result = await page.evaluate(async function(href: string) {
      const host = new Velcro.ResolverHostUnpkg();
      const resolver = new Velcro.Resolver(host);
      const resolved = await resolver.resolve(href);

      return resolved ? resolved.href : null;
    }, 'https://unpkg.com/webtask-test-module-1@1');

    expect(result).to.equal('https://unpkg.com/webtask-test-module-1@1.0.0/index.js');
  });
});
