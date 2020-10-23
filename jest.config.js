const { Timing } = require('@pollyjs/core');
const { MODES } = require('@pollyjs/utils');

// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

module.exports = {
  // All imported modules in your tests should be mocked automatically
  // automock: false,

  // Stop running tests after `n` failures
  // bail: 0,

  // The directory where Jest should store its cached dependency information
  // cacheDirectory: "/private/var/folders/k0/9ybx4mp53tj8p1x5qgtlv10m0000gn/T/jest_dx",

  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  // collectCoverage: false,

  // An array of glob patterns indicating a set of files for which coverage information should be collected
  // collectCoverageFrom: undefined,

  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',

  // An array of regexp pattern strings used to skip coverage collection
  // coveragePathIgnorePatterns: [
  //   "/node_modules/"
  // ],

  // A list of reporter names that Jest uses when writing coverage reports
  // coverageReporters: [
  //   "json",
  //   "text",
  //   "lcov",
  //   "clover"
  // ],

  // An object that configures minimum threshold enforcement for coverage results
  // coverageThreshold: undefined,

  // A path to a custom dependency extractor
  // dependencyExtractor: undefined,

  // Make calling deprecated APIs throw helpful error messages
  // errorOnDeprecated: false,

  // Force coverage collection from ignored files using an array of glob patterns
  // forceCoverageMatch: [],

  // A path to a module which exports an async function that is triggered once before all test suites
  // globalSetup: "globalSetup.js',

  // A path to a module which exports an async function that is triggered once after all test suites
  globalTeardown: './globalTeardown.ts',

  // A set of global variables that need to be available in all test environments
  // globals: {},

  // The maximum amount of workers used to run your tests. Can be specified as % or a number. E.g. maxWorkers: 10% will use 10% of your CPU amount + 1 as the maximum worker number. maxWorkers: 2 will use a maximum of 2 workers.
  // maxWorkers: "50%",

  // An array of directory names to be searched recursively up from the requiring module's location
  // moduleDirectories: [
  //   "node_modules"
  // ],

  // An array of file extensions your modules use
  // moduleFileExtensions: [
  //   "js",
  //   "json",
  //   "jsx",
  //   "ts",
  //   "tsx",
  //   "node"
  // ],

  // A map from regular expressions to module names or to arrays of module names that allow to stub out resources with a single module
  // moduleNameMapper: {},

  // An array of regexp pattern strings, matched against all module paths before considered 'visible' to the module loader
  // modulePathIgnorePatterns: [],

  // Activates notifications for test results
  // notify: false,

  // An enum that specifies notification mode. Requires { notify: true }
  // notifyMode: "failure-change",

  // A preset that is used as a base for Jest's configuration

  // Run tests from one or more projects
  projects: [
    {
      displayName: 'Integration tests',
      moduleNameMapper: {
        '^@velcro/node-libs/(.*)$': '<rootDir>/packages/@velcro/node-libs/$1',
        '^@velcro/(.*)$': '<rootDir>/packages/@velcro/$1/src',
      },
      preset: 'ts-jest/presets/js-with-ts',
      setupFilesAfterEnv: ['@spotify/polly-jest-presets'],
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__test__/**/*.ts'],
      globals: {
        pollyConfig: {
          // Recording missing requests is (unfortunately) required during the transition
          // to a new version (such as CI) where references to `@velcro/node-libs@<new_version>`
          // will be made that will need to be recorded and allowed.
          recordFailedRequests: true,
          recordIfMissing: true,
          timing: Timing.relative(0),
        },
        'ts-jest': {
          tsconfig: `tsconfig.json`,
        },
      },
    },
    ...[
      '@velcro/bundler',
      '@velcro/common',
      '@velcro/plugin-css',
      '@velcro/plugin-sucrase',
      '@velcro/resolver',
      '@velcro/runner',
      '@velcro/strategy-cdn',
      '@velcro/strategy-compound',
      '@velcro/strategy-fs',
      '@velcro/strategy-memory',
      'nostalgie',
    ].map((name) => ({
      displayName: name,
      moduleNameMapper: {
        '^@velcro/node-libs/(.*)$': '<rootDir>/packages/@velcro/node-libs/$1',
        '^@velcro/(.*)$': '<rootDir>/packages/@velcro/$1/src',
      },
      preset: 'ts-jest/presets/js-with-ts',
      setupFilesAfterEnv: ['@spotify/polly-jest-presets'],
      testEnvironment: 'node',
      testMatch: [`<rootDir>/packages/${name}/**/*.test.ts`],
      globals: {
        pollyConfig: {
          // Recording missing requests is (unfortunately) required during the transition
          // to a new version (such as CI) where references to `@velcro/node-libs@<new_version>`
          // will be made that will need to be recorded and allowed.
          recordFailedRequests: true,
          recordIfMissing: true,
          timing: Timing.relative(0),
        },
        'ts-jest': {
          tsconfig: `packages/${name}/tsconfig.json`,
        },
      },
    })),
  ],
};
