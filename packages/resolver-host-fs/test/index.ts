import * as Fs from 'fs';
import { resolve } from 'path';

import { expect } from 'code';
import { script } from 'lab';

import { browser as browserMain, main, name } from '../package.json';
import * as Velcro from '../';

export const lab = script();

const { describe, it } = lab;

describe(name, () => {
  it('will resolve a module entrypoint', async () => {
    const href = `file://${resolve(__dirname, '../')}/`;
    const host = new Velcro.ResolverHostFs({
      fs: Fs,
    });
    const resolver = new Velcro.Resolver(host);
    const resolved = await resolver.resolve(href);

    expect(resolved).to.be.an.instanceOf(URL);
    expect(resolved!.href).to.equal(`file://${resolve(__dirname, '../', main)}`);
  });

  it('will resolve a module entrypoint with the browser field', async () => {
    const href = `file://${resolve(__dirname, '../')}/`;
    const host = new Velcro.ResolverHostFs({
      fs: Fs,
    });
    const resolver = new Velcro.Resolver(host, {
      packageMain: ['browser', 'main'],
    });
    const resolved = await resolver.resolve(href);

    expect(resolved).to.be.an.instanceOf(URL);
    expect(resolved!.href).to.equal(`file://${resolve(__dirname, '../', browserMain)}`);
  });
});
