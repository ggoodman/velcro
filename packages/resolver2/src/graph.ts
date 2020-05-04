// import { Uri } from './uri';
// import { Resolver } from './resolver';
// import { CancellationTokenSource } from 'ts-primitives';
// import { parseFile } from './bundling/parser';
// import { ResolverStrategy } from './strategy';
// import { Decoder } from './decoder';

// export class Graph {
//   #decoder = new Decoder();
//   #resolver: Resolver;
//   #strategy: ResolverStrategy;

//   constructor(strategy: ResolverStrategy) {
//     this.#strategy = strategy;
//     this.#resolver = new Resolver(strategy, {
//       extensions: ['.js'],
//       packageMain: ['main'],
//     });
//   }

//   async add(spec: string, fromUri?: Uri) {
//     const tokenSource = new CancellationTokenSource();
//     const token = tokenSource.token;
//     const queue = [[spec, fromUri]] as Array<[string, Uri?]>;

//     try {
//       while(queue.length) {
//         const [spec, fromUri] = queue.shift()!;
//         const {uri} = await this.#resolver.resolve(spec, fromUri, {
//           token,
//         });

//         if (uri) {
//           const {content} = await this.#resolver.readFileContent(uri.toString(), { token });
//           const code = this.#resolver.de
//           const {} = parseFile(uri.toString(), content
//         }
//       }
//     } finally {
//       tokenSource.dispose(true);
//     }
//   }
// }
