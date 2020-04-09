import { fetch, AbortController, AbortError, AbortSignal } from 'fetch-h2';
import { read, request } from '@hapi/wreck';
import { CancellationToken } from 'ts-primitives';

import { CdnStrategy } from './cdnStrategy';
import { Resolver } from './resolver';
import { CanceledError } from './error';

export function signalFromCancellationToken(token: CancellationToken): AbortSignal {
  const abortController = new AbortController();

  if (token.isCancellationRequested) {
    abortController.abort();
  } else {
    token.onCancellationRequested(() => abortController.abort());
  }

  return abortController.signal;
}

export async function fetchBufferWithFetch(href: string, token: CancellationToken) {
  const signal = signalFromCancellationToken(token);

  try {
    const res = await fetch(href, {
      redirect: 'follow',
      signal,
      timeout: 10000,
    });

    return res.arrayBuffer();
  } catch (err) {
    if (err instanceof AbortError) {
      throw new CanceledError();
    }

    throw err;
  }
}

export async function fetchBufferWithWreck(href: string, token: CancellationToken) {
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
  for (let i = 0; i < 10; i++) {
    {
      const start = Date.now();
      const strategy = new CdnStrategy(fetchBufferWithWreck);
      const resolver = new Resolver(strategy, {
        extensions: ['.js'],
        packageMain: ['main'],
      });

      const result = await Promise.all([
        resolver.resolve('https://unpkg.com/react'),
        resolver.resolve('https://unpkg.com/react-dom'),
      ]);
      console.log(
        'Wreck',
        result.map((r) => r.uri?.toString()),
        Date.now() - start
      );
    }
    {
      const start = Date.now();
      const strategy = new CdnStrategy(fetchBufferWithFetch);
      const resolver = new Resolver(strategy, {
        extensions: ['.js'],
        packageMain: ['main'],
      });

      const result = await Promise.all([
        resolver.resolve('https://unpkg.com/react'),
        resolver.resolve('https://unpkg.com/react-dom'),
      ]);
      console.log(
        'Fetch',
        result.map((r) => r.uri?.toString()),
        Date.now() - start
      );

      await Promise.all([
        resolver.resolve('https://unpkg.com/react'),
        resolver.resolve('https://unpkg.com/react-dom'),
      ]);
      console.log(
        'Fetch',
        result.map((r) => r.uri?.toString()),
        Date.now() - start
      );
    }
  }
}

if (!module.parent) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
