import * as Fs from 'fs';
import { resolve } from 'path';

import { Resolver } from '@velcro/resolver';
import { expect } from '@hapi/code';
import { script } from '@hapi/lab';

import { browser as browserMain, main, name } from '../package.json';
import { ResolverHostFs } from '../';

export const lab = script();

const { describe, it } = lab;

describe(name, () => {
  it('will resolve a module entrypoint', async () => {
    const href = `file://${resolve(__dirname, '../')}/`;
    const host = new ResolverHostFs({
      fs: Fs,
    });
    const resolver = new Resolver(host);
    const result = await resolver.resolve(href);

    expect(result.resolvedUrl).to.be.an.instanceOf(URL);
    expect(result.resolvedUrl!.href).to.equal(`file://${resolve(__dirname, '../', main)}`);
  });

  it('will resolve a module entrypoint with the browser field', async () => {
    const href = `file://${resolve(__dirname, '../')}/`;
    const host = new ResolverHostFs({
      fs: Fs,
    });
    const resolver = new Resolver(host, {
      packageMain: ['browser', 'main'],
    });
    const result = await resolver.resolve(href);

    expect(result.resolvedUrl).to.be.an.instanceOf(URL);
    expect(result.resolvedUrl!.href).to.equal(`file://${resolve(__dirname, '../', browserMain)}`);
  });
});
