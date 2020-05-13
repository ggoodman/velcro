import { parseJavaScript } from '..';
import { Uri } from '../../../util/uri';
import { SourceModuleDependencyKind } from '../../sourceModuleDependency';

jest.mock('../../../context');
jest.mock('../../../resolver');
jest.mock('../../../strategy');

describe('JavaScript parser', () => {
  test('discovers unbound symbols', () => {
    const testOne = (code: string, expectedSpecs: string[], nodeEnv = 'development') => {
      const parseResult = parseJavaScript(Uri.file('/index.js'), code, {
        environmentModules: {},
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
      const parseResult = parseJavaScript(Uri.file('/index.js'), code, {
        environmentModules: {},
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
      const parseResult = parseJavaScript(Uri.file('/index.js'), code, {
        environmentModules: {},
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
});
