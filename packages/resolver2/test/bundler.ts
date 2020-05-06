// import { fetch, AbortController, AbortError, AbortSignal } from 'fetch-h2';
import { script } from '@hapi/lab';
import { read, request } from '@hapi/wreck';
import * as MemFs from 'memfs';
import { CancellationToken } from 'ts-primitives';
import { CanceledError } from '../src/error';
import { Resolver } from '../src/resolver';
import { CdnStrategy } from '../src/strategy/cdn';
import { CompoundStrategy } from '../src/strategy/compound';
import { FsStrategy } from '../src/strategy/fs';
import { FsInterface } from '../src/strategy/fs/types';
import { polly } from './lib/wreck';

export const lab = script();

const { before, after, describe, it } = lab;

async function fetchBufferWithWreck(href: string, token: CancellationToken) {
  const resPromise = request('get', href, {
    redirects: 3,
    timeout: 50000,
  });

  token.onCancellationRequested(() => resPromise.req.destroy(new CanceledError()));

  const res = await resPromise;

  if (res.statusCode === 404) {
    return null;
  }

  if (res.statusCode !== 200) {
    throw new Error(`Error while reading from '${href}': ${res.statusCode} - ${res.statusMessage}`);
  }

  return read(res);
}

function createBundler(rootFs: typeof MemFs.vol) {
  const fsStrategy = new FsStrategy({ fs: MemFs.createFsFromVolume(rootFs) as FsInterface });
  const cdnStrategy = new CdnStrategy(fetchBufferWithWreck);
  const strategy = new CompoundStrategy({
    strategies: [cdnStrategy, fsStrategy],
  });
  const resolver = new Resolver(strategy, {
    extensions: ['.js'],
    packageMain: ['main'],
  });

  // return createBundle({ resolver});
}

describe('Resolver', () => {
  before(async () => polly.record());
  after(async () => polly.stop());

  it.only('will bundle some files', { timeout: 10000 }, async () => {
    const bundler = createBundler(
      MemFs.Volume.fromJSON(
        {
          'package.json': JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: {
              react: '^16.10.0',
            },
          }),
          'index.js': 'module.exports = require("react");',
        },
        '/'
      )
    );

    // await bundler.add(Uri.file('/'));
  });
});
