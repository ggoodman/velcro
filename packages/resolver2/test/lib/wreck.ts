import { Polly } from '@pollyjs/core';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import NodeFsPersister from '@pollyjs/persister-fs';

Polly.register(NodeFsPersister);
Polly.register(NodeHttpAdapter);

export const polly = new Polly('Resolver', {
  adapters: ['node-http'],
  persister: 'fs',
  recordFailedRequests: true,
  persisterOptions: {
    fs: {
      recordingsDir: `${__dirname}/recordings`,
    },
  },
});
