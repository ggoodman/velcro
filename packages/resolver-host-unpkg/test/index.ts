import { resolve } from 'path';

import { expect } from '@hapi/code';
import { readFile } from 'fs-extra';
import { script } from '@hapi/lab';
import { Browser, launch } from 'puppeteer';

import { browser as browserMain, name } from '../package.json';

export const lab = script();

const { after, before, describe, it } = lab;

declare const Velcro: typeof import('../') & typeof import('@velcro/resolver');

describe(name, { timeout: 10000 }, () => {
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
      const result = await resolver.resolve(href);

      return result.resolvedUrl ? result.resolvedUrl.href : null;
    }, 'https://unpkg.com/webtask-test-module-1');

    expect(result).to.equal('https://unpkg.com/webtask-test-module-1@2.0.0/index.js');
  });

  it('will support cancelling operations', async () => {
    const page = await browser.newPage();
    const scripts = await codePromises;

    await Promise.all(scripts.map(content => page.addScriptTag({ content })));

    const result = await page.evaluate(async function(href: string) {
      const host = new Velcro.ResolverHostUnpkg();
      const resolver = new Velcro.Resolver(host);
      const tokenSource = new Velcro.CancellationTokenSource();
      const request = resolver.resolve(href, { token: tokenSource.token });

      tokenSource.cancel();

      try {
        return await request;
      } catch (err) {
        return err.name;
      }
    }, 'https://unpkg.com/webtask-test-module-1');

    expect(result).to.equal('CanceledError');
  });

  it('will resolve a module entrypoint with partial version hints', async () => {
    const page = await browser.newPage();
    const scripts = await codePromises;

    await Promise.all(scripts.map(content => page.addScriptTag({ content })));

    const result = await page.evaluate(async function(href: string) {
      const host = new Velcro.ResolverHostUnpkg();
      const resolver = new Velcro.Resolver(host);
      const result = await resolver.resolve(href);

      return result.resolvedUrl ? result.resolvedUrl.href : null;
    }, 'https://unpkg.com/webtask-test-module-1@1');

    expect(result).to.equal('https://unpkg.com/webtask-test-module-1@1.0.0/index.js');
  });
});
