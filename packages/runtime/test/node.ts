import * as Fs from 'fs';

import { expect } from 'code';
import { fetch } from 'fetch-h2';
import { script } from 'lab';

import { name } from '../package.json';
import * as Velcro from '../dist/dist-main';

export const lab = script();

const { describe, it } = lab;

describe(`${name} in node`, { timeout: 200000 }, () => {
  describe('with the ResolverHostUnpkg', () => {
    it('will load react@16', async () => {
      const spec = 'react@16';
      const runtime = Velcro.createRuntime({
        fetch,
        resolveBareModule: Velcro.resolveBareModuleToUnpkg,
        injectGlobals: false,
      });
      const inst = await runtime.import(spec);
      const result = Object.keys(inst);

      expect(result).to.contain('createElement');
    });

    it('will load @angular/core@7', { timeout: 10000 }, async () => {
      const spec = '@angular/core@7';
      const runtime = Velcro.createRuntime({
        fetch,
        resolveBareModule: Velcro.resolveBareModuleToUnpkg,
        injectGlobals: false,
      });
      const inst = await runtime.import(spec);
      const result = Object.keys(inst);

      expect(result).to.contain(['Component', 'Directive', 'Input', 'Output', 'Pipe']);
    });
  });

  describe('with the ResolverHostFs', () => {
    it('will load itself', async () => {
      const spec = `file://${Velcro.util.resolve(__dirname, '../')}`;
      const resolverHost = new Velcro.ResolverHostFs({ fs: Fs });
      const runtime = Velcro.createRuntime({
        injectGlobals: false,
        resolveBareModule: Velcro.resolveBareModuleWithNode,
        resolverHost,
      });
      const inst = await runtime.import(spec);
      const result = Object.keys(inst);

      expect(inst).to.be.an.object();
      expect(result).to.equal(Object.keys(Velcro));
      expect(result).to.not.equal(inst);
    });
  });
});
