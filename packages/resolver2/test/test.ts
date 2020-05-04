// // import { fetch, AbortController, AbortError, AbortSignal } from 'fetch-h2';
// import { read, request } from '@hapi/wreck';
// import { CancellationToken } from 'ts-primitives';

// import { CdnStrategy } from '../src/strategy/cdn';
// import { Resolver } from '../src/resolver';
// import { CanceledError, EntryNotFoundError } from '../src/error';

// import { expect } from '@hapi/code';
// import { script } from '@hapi/lab';
// import { Uri } from '../src/uri';
// // import { parseFile } from '../src/parser';
// import { channel, put, select } from '../src/csp';
// import { Polly } from './lib/wreck';

// export const lab = script();

// const { after, describe, it } = lab;

// async function fetchBufferWithWreck(href: string, token: CancellationToken) {
//   const resPromise = request('get', href, {
//     redirects: 3,
//     timeout: 50000,
//   });

//   token.onCancellationRequested(() => resPromise.req.destroy(new CanceledError()));

//   const res = await resPromise;

//   if (res.statusCode === 404) {
//     return null;
//   }

//   if (res.statusCode !== 200) {
//     throw new Error(`Error while reading from '${href}': ${res.statusCode} - ${res.statusMessage}`);
//   }

//   return read(res);
// }

// describe('Resolver', () => {
//   const polly = new Polly('Resolver', {
//     adapters: ['node-http'],
//     persister: 'fs',
//     recordFailedRequests: true,
//     persisterOptions: {
//       fs: {
//         recordingsDir: `${__dirname}/recordings`,
//       },
//     },
//   });

//   after(async () => polly.stop());

//   it('will resolve the bare module "react@16.12.x"', async () => {
//     const strategy = new CdnStrategy(fetchBufferWithWreck);
//     const resolver = new Resolver(strategy, {
//       extensions: ['.js'],
//       packageMain: ['main'],
//     });

//     const resolved = await resolver.resolveBareModule('react@16.10.x');

//     expect(resolved.found).to.equal(true);
//     expect([...resolved.visited]).to.contain('https://cdn.jsdelivr.net/npm/react@16.10.2/');
//     expect(resolved.uri).to.equal(Uri.parse('https://cdn.jsdelivr.net/npm/react@16.10.2/index.js'));
//   });

//   it('will resolve the bare modules "react@16.12.x" and "react-dom@16.12.x" concurrently', async () => {
//     const strategy = new CdnStrategy(fetchBufferWithWreck);
//     const resolver = new Resolver(strategy, {
//       extensions: ['.js'],
//       packageMain: ['main'],
//     });

//     const resolved = await Promise.all([
//       resolver.resolveBareModule('react@16.10.x'),
//       resolver.resolveBareModule('react-dom@16.10.x'),
//     ]);

//     expect(resolved[0].found).to.equal(true);
//     expect([...resolved[0].visited]).to.equal([
//       'https://cdn.jsdelivr.net/npm/react@16.10.2/',
//       'https://cdn.jsdelivr.net/npm/react@16.10.2/package.json',
//       'https://cdn.jsdelivr.net/npm/react@16.10.2/index.js',
//     ]);
//     expect(resolved[0].uri).to.equal(
//       Uri.parse('https://cdn.jsdelivr.net/npm/react@16.10.2/index.js')
//     );

//     expect(resolved[1].found).to.equal(true);
//     expect([...resolved[1].visited]).to.equal([
//       'https://cdn.jsdelivr.net/npm/react-dom@16.10.2/',
//       'https://cdn.jsdelivr.net/npm/react-dom@16.10.2/package.json',
//       'https://cdn.jsdelivr.net/npm/react-dom@16.10.2/index.js',
//     ]);
//     expect(resolved[1].uri).to.equal(
//       Uri.parse('https://cdn.jsdelivr.net/npm/react-dom@16.10.2/index.js')
//     );
//   });

//   it('will fail to resolve a bare module whose range cannot be satisfied "react@16.999.x"', async () => {
//     const strategy = new CdnStrategy(fetchBufferWithWreck);
//     const resolver = new Resolver(strategy, {
//       extensions: ['.js'],
//       packageMain: ['main'],
//     });

//     const resolved = resolver.resolveBareModule('react@16.999.x');

//     await expect(resolved).to.reject(EntryNotFoundError);
//   });

//   it.only('will traverse react', async () => {
//     const strategy = new CdnStrategy(fetchBufferWithWreck);
//     const resolver = new Resolver(strategy, {
//       extensions: ['.js'],
//       packageMain: ['main'],
//     });

//     const queues = {
//       resolve: channel<[string, string?]>(),
//       resolved: channel<Uri>(),
//     };

//     put(queues.resolve, ['react@16.10.x']);

//     while (queues.resolve.length || queues.resolved.length) {
//       const record = await select(queues);

//       switch (record.key) {
//         case 'resolved': {
//           console.log('resolved', record.value);
//           break;
//         }
//         case 'resolve': {
//           resolver.resolveBareModule(record.value[0]).then(({ uri }) => {
//             put(queues.resolved, uri!);
//           });
//           break;
//         }
//       }
//     }

//     // async function resolve(channel: AsyncIterable<[string, string?]>) {
//     //   for await (const [spec, fromUri] of channel) {
//     //   }
//     // }

//     // const { content, uri } = await resolver.readFileContent('react@16.10.x', {
//     //   parseAsString: true,
//     // });

//     // let result;
//     // for (let i = 0; i < 100; i++) {
//     //   console.time('parse');
//     //   result = parseFile(uri?.toString(true) || '', content);
//     //   console.timeEnd('parse');
//     // }

//     // console.log(result?.requireDependencies);

//     // const file = Typescript.createSourceFile(
//     //   uri!.fsPath,
//     //   content,
//     //   Typescript.ScriptTarget.ES5,
//     //   undefined
//     // );

//     // function visit(node: Typescript.Node) {
//     //   Typescript.isRequire;
//     //   if (Typescript.isCallExpression(node)) {
//     //     if (Typescript.isIdentifier(node.expression) && node.expression.text === 'require') {
//     //       const firstAgument = node.arguments[0];

//     //       Typescript.visitLexicalEnvironment();

//     //       if (node.arguments.length === 1 && Typescript.isStringLiteralLike(firstAgument)) {
//     //         console.log(node.getFullText(file));
//     //       }
//     //     }
//     //   }

//     //   node.forEachChild(visit);
//     // }

//     // file.forEachChild(visit);

//     // console.log('read react', String(uri), content);
//   });
// });
