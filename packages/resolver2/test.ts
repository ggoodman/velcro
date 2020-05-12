import { read, request } from '@hapi/wreck';
import * as MemFs from 'memfs';
import { CancellationToken } from 'ts-primitives';
import { CanceledError } from './src/error';
import { Graph } from './src/graph/graph';
import { buildGraph } from './src/graph/graphBuilder';
import { Resolver } from './src/resolver';
import { CdnStrategy } from './src/strategy/cdn';
import { CompoundStrategy } from './src/strategy/compound';
import { FsStrategy } from './src/strategy/fs';
import { FsInterface } from './src/strategy/fs/types';
import { Uri } from './src/uri';
import { polly } from './test/lib/wreck';

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
          'react-ui': '^1.0.0-beta.25',
        },
      }),
      'index.js': 'module.exports = require("react-ui");',
    },
    '/'
  );
  const fsStrategy = new FsStrategy({ fs: MemFs.createFsFromVolume(rootFs) as FsInterface });
  const cdnStrategy = new CdnStrategy(fetchBufferWithWreck, 'jsdelivr');
  const strategy = new CompoundStrategy({
    strategies: [cdnStrategy, fsStrategy],
  });
  const resolver = new Resolver(strategy, {
    extensions: ['.js', '.json'],
    packageMain: ['main'],
  });

  const start = process.hrtime();
  let graph: Graph;
  try {
    graph = await buildGraph({
      entrypoints: [Uri.file('')],
      resolver,
      nodeEnv: 'development',
    });
  } catch (err) {
    console.trace(err);
    return;
  } finally {
    const delta = process.hrtime(start);

    console.error(delta[0] * 1_000 + delta[1] / 1_000_000);

    await polly.stop();
  }

  for (const chunk of graph.splitChunks()) {
    console.log(chunk.toString());
  }
}

main();
