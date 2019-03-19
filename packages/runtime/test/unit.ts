import { expect } from 'code';
import { script } from 'lab';

import { name } from '../package.json';
import { parse } from '../src/ast';
import { traverse } from '../src/traverse';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from '../src/visitors';

export const lab = script();

const { describe, it } = lab;

describe(`${name} unit tests`, () => {
  describe('ast visitor', () => {
    it('will not visit branches based on process.env.NODE_ENV === "development"', async () => {
      const code = function() {
        if (process.env.NODE_ENV === 'development') {
          require('OK');
        } else {
          require('NOT OK');
        }
      }.toString();
      const ast = parse(`var fn = ${code}`);
      const ctx: DependencyVisitorContext = {
        injectGlobals: new Set(),
        locals: new Map(),
        nodeEnv: 'development',
        replacements: [],
        requires: [],
        resolves: [],
        skip: new Set(),
      };

      traverse(ast, ctx, scopingAndRequiresVisitor);

      expect(ctx.requires.map(node => node.value)).to.equal(['OK']);
      expect(ctx.resolves.length).to.equal(0);
      expect(ctx.skip.size).to.equal(1);
    });

    it('will find unbound globals', async () => {
      const code = function({ a: b }: any = { a: 'hi' }) {
        if (process.env.NODE_ENV === 'development') {
          b = {
            a: 'A',
          };
          require('OK');
        } else {
          require('NOT OK' + b);
        }

        function test() {
          if (evtType === 'yes') {
          }
        }

        var evtType = '';
      }.toString();
      const ast = parse(`var fn = ${code}`);
      const ctx: DependencyVisitorContext = {
        injectGlobals: new Set(),
        locals: new Map(),
        nodeEnv: 'development',
        replacements: [],
        requires: [],
        resolves: [],
        skip: new Set(),
      };

      traverse(ast, ctx, scopingAndRequiresVisitor);
      traverse(ast, ctx, collectGlobalsVisitor);

      expect(Array.from(ctx.injectGlobals)).to.equal(['process', 'require']);
    });
  });
});
