import { read, request } from '@hapi/wreck';
import * as MemFs from 'memfs';
import { CancellationToken } from 'ts-primitives';

import { createBundle } from './src/bundling/bundler';
import { CdnStrategy } from './src/strategy/cdn';
import { CompoundStrategy } from './src/strategy/compound';
import { FsStrategy } from './src/strategy/fs';
import { Resolver } from './src/resolver';
import { Uri } from './src/uri';
import { FsInterface } from './src/strategy/fs/types';

import { polly } from './test/lib/wreck';
import { CanceledError } from './src/error';

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

async function main() {
  // polly.record();
  polly.replay();

  const rootFs = MemFs.Volume.fromJSON(
    {
      'package.json': JSON.stringify({
        name: 'test',
        version: '1.0.0',
        dependencies: {
          '@emotion/core': '^10.0.28',
          react: '^16.10.0',
          'react-dom': '^16.10.0',
        },
      }),
      'index.js':
        'module.exports = { "emotion": require("@emotion/core"), "react": require("react"), "react-dom": require("react-dom") };',
    },
    '/'
  );
  const fsStrategy = new FsStrategy({ fs: MemFs.createFsFromVolume(rootFs) as FsInterface });
  const cdnStrategy = new CdnStrategy(fetchBufferWithWreck);
  const strategy = new CompoundStrategy({
    strategies: [cdnStrategy, fsStrategy],
  });
  const resolver = new Resolver(strategy, {
    extensions: ['.js', '.json'],
    packageMain: ['main'],
  });

  try {
    console.time('add');
    const sourceModules = await createBundle({
      entrypoints: [Uri.file('')],
      resolver,
      nodeEnv: 'development',
    });
    console.log('Added %d source modules', sourceModules.size);
  } finally {
    console.timeEnd('add');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
