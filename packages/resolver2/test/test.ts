// import { fetch, AbortController, AbortError, AbortSignal } from 'fetch-h2';
import { read, request } from '@hapi/wreck';
import { Polly } from '@pollyjs/core';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import NodeFsPersister from '@pollyjs/persister-fs';
import { CancellationToken } from 'ts-primitives';

import { CdnStrategy } from '../src/cdnStrategy';
import { Resolver } from '../src/resolver';
import { CanceledError, EntryNotFoundError } from '../src/error';

import { expect } from '@hapi/code';
import { script } from '@hapi/lab';
import { Uri } from '../src/uri';

export const lab = script();

const { after, describe, it } = lab;

Polly.register(NodeFsPersister);
Polly.register(NodeHttpAdapter);

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

describe('Resolver', () => {
  const polly = new Polly('Resolver', {
    adapters: ['node-http'],
    persister: 'fs',
    recordFailedRequests: true,
    persisterOptions: {
      fs: {
        recordingsDir: `${__dirname}/recordings`,
      },
    },
  });

  after(async () => polly.stop());

  it('will resolve the bare module "react@16.12.x"', async () => {
    const strategy = new CdnStrategy(fetchBufferWithWreck);
    const resolver = new Resolver(strategy, {
      extensions: ['.js'],
      packageMain: ['main'],
    });

    const resolved = await resolver.resolveBareModule('react@16.10.x');

    expect(resolved.found).to.equal(true);
    expect([...resolved.visited]).to.contain('https://cdn.jsdelivr.net/npm/react@16.10.2/');
    expect(resolved.uri).to.equal(Uri.parse('https://cdn.jsdelivr.net/npm/react@16.10.2/index.js'));
  });

  it('will resolve the bare modules "react@16.12.x" and "react-dom@16.12.x" concurrently', async () => {
    const strategy = new CdnStrategy(fetchBufferWithWreck);
    const resolver = new Resolver(strategy, {
      extensions: ['.js'],
      packageMain: ['main'],
    });

    const resolved = await Promise.all([
      resolver.resolveBareModule('react@16.10.x'),
      resolver.resolveBareModule('react-dom@16.10.x'),
    ]);

    expect(resolved[0].found).to.equal(true);
    expect([...resolved[0].visited]).to.equal([
      'https://cdn.jsdelivr.net/npm/react@16.10.2/',
      'https://cdn.jsdelivr.net/npm/react@16.10.2/package.json',
      'https://cdn.jsdelivr.net/npm/react@16.10.2/index.js',
    ]);
    expect(resolved[0].uri).to.equal(
      Uri.parse('https://cdn.jsdelivr.net/npm/react@16.10.2/index.js')
    );

    expect(resolved[1].found).to.equal(true);
    expect([...resolved[1].visited]).to.equal([
      'https://cdn.jsdelivr.net/npm/react-dom@16.10.2/',
      'https://cdn.jsdelivr.net/npm/react-dom@16.10.2/package.json',
      'https://cdn.jsdelivr.net/npm/react-dom@16.10.2/index.js',
    ]);
    expect(resolved[1].uri).to.equal(
      Uri.parse('https://cdn.jsdelivr.net/npm/react-dom@16.10.2/index.js')
    );
  });

  it('will fail to resolve a bare module whose range cannot be satisfied "react@16.999.x"', async () => {
    const strategy = new CdnStrategy(fetchBufferWithWreck);
    const resolver = new Resolver(strategy, {
      extensions: ['.js'],
      packageMain: ['main'],
    });

    const resolved = resolver.resolveBareModule('react@16.999.x');

    await expect(resolved).to.reject(EntryNotFoundError);
  });

  it.only('will traverse react', async () => {
    const strategy = new CdnStrategy(fetchBufferWithWreck);
    const resolver = new Resolver(strategy, {
      extensions: ['.js'],
      packageMain: ['main'],
    });

    const { content, uri } = await resolver.readFileContent('react@16.10.x', {
      parseAsString: true,
    });

    console.log('read react', String(uri), content);
  });
});
