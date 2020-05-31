import { Uri } from '@velcro/common';
import { parse } from '.';
import { SourceModuleDependencyKind } from '../sourceModuleDependency';

describe('JavaScript CommonJS parser', () => {
  test('discovers unbound symbols', () => {
    const testOne = (code: string, expectedSpecs: string[], nodeEnv = 'development') => {
      const parseResult = parse(Uri.file('/index.js'), code, {
        globalModules: {},
        nodeEnv,
      });

      expect(
        parseResult.dependencies
          .filter((dep) => dep.kind === SourceModuleDependencyKind.Require)
          .map((dep) => dep.spec)
      ).toStrictEqual(expectedSpecs);
    };

    testOne('require("hello")', ['hello']);
  });

  test('prunes branches based on process.env.NODE_ENV', () => {
    const testOne = (code: string, expectedSpecs: string[], nodeEnv = 'development') => {
      const parseResult = parse(Uri.file('/index.js'), code, {
        globalModules: {},
        nodeEnv,
      });

      expect(
        parseResult.dependencies
          .filter((dep) => dep.kind === SourceModuleDependencyKind.Require)
          .map((dep) => dep.spec)
      ).toStrictEqual(expectedSpecs);
    };

    testOne('require("hello")', ['hello']);
    testOne(
      'if (process.env.NODE_ENV === "development") { require("hello") } else { require("world") }',
      ['hello']
    );
    testOne(
      'if (process.env.NODE_ENV === "development") { require("hello") } else { require("world") }',
      ['world'],
      'production'
    );
    testOne(
      'if (process.env.NODE_ENV !== "development") { require("hello") } else { require("world") }',
      ['world']
    );
    testOne(
      'if (process.env.NODE_ENV !== "development") { require("hello") } else { require("world") }',
      ['hello'],
      'production'
    );
  });

  test('will not inject dependencies if the value will be replaced', () => {
    const testOne = (code: string, expectedSpecs: string[], nodeEnv = 'development') => {
      const parseResult = parse(Uri.file('/index.js'), code, {
        globalModules: {
          process: { spec: '@@process' },
        },
        nodeEnv,
      });

      expect(
        parseResult.dependencies
          .filter((dep) => dep.kind === SourceModuleDependencyKind.GlobalObject)
          .map((dep) => dep.spec)
      ).toStrictEqual(expectedSpecs);
    };

    testOne('process.cwd()', ['@@process']);
    testOne('if (process.env.NODE_ENV !== "development") { require("hello"); }', []);
    testOne('if (process.env.NODE_ENV !== "development") { process.cwd(); }', []);
  });

  test('will not inject dependencies if the value will be replaced', () => {
    const testOne = (code: string, expectedSpecs: string[], nodeEnv = 'development') => {
      const parseResult = parse(Uri.file('/index.js'), code, {
        globalModules: {
          global: { spec: '@@global' },
        },
        nodeEnv,
      });

      expect(
        parseResult.dependencies
          .filter((dep) => dep.kind === SourceModuleDependencyKind.GlobalObject)
          .map((dep) => dep.spec)
      ).toStrictEqual(expectedSpecs);
    };

    testOne("var isWindows = 'navigator' in global && /Win/i.test(navigator.platform);", [
      '@@global',
    ]);
  });

  test('will replace injectedGlobals with calls to require', () => {
    const testOne = (code: string, expectedCode: string, nodeEnv = 'development') => {
      const parseResult = parse(Uri.file('/index.js'), code, {
        globalModules: {
          global: { spec: '@@global' },
        },
        nodeEnv,
      });

      expect(parseResult.code.toString()).toEqual(expectedCode);
    };

    testOne(
      "var isWindows = 'navigator' in global && /Win/i.test(navigator.platform);",
      'var isWindows = \'navigator\' in require("@@global") && /Win/i.test(navigator.platform);'
    );
  });
});
