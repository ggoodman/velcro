interface ConnectOptions {
  /**
   *
   * @param messageHandler
   */
  registerMessageListener(messageHandler: MessageHandler): IDisposable | unknown;
}

interface IDisposable {
  dispose(): void;
}

type MessageHandler = (message: Json) => void;

export type ExposedApi = {
  [key: string]: <T>(...args: any[]) => Promise<T> | T;
};

type Json = string | number | boolean | null | { [property: string]: Json } | Json[];

// export async function connectRpc<T extends ExposedApi>(exposedApi: ExposedApi, options: ConnectOptions): Promise<T> {

// }

// export class RpcClient {
//   private readonly localFunctions = new Map<number, Function>();
//   private nextSeqId = 0;
//   private readonly foo = 'var';

//   constructor(
//       exposedApi,
//       { isChild, registerMessageListener, sendMessage, showWarnings = false }
//   ) {
//       /**
//        * @type {Map<number,function>}
//        */
//       this.localMethods = new Map();
//       this.nextSeqId = 0;
//       this.remoteApiDfd = new Deferred();
//       /**
//        * @type {Map<number,Deferred>}
//        */
//       this.remoteInvocations = new Map();
//       this.removeMessageListener = registerMessageListener(
//           this.onMessage.bind(this)
//       );
//       this.sendMessage = trySendMessage(sendMessage);
//       this.showWarnings = !!showWarnings;

//       if (isChild) {
//           // If this is a child, we send the api immediately
//           this.sendApi(exposedApi);
//       } else {
//           // If this is a parent, we wait to receive a child's
//           // remote api before sending the exposed api
//           this.remoteApiDfd.promise.then(() => {
//               this.sendApi(exposedApi);
//           });
//       }
//   }

//   getRemoteApi() {
//       return this.remoteApiDfd.promise;
//   }

//   hydrateResult(data) {
//       if (data && typeof data === 'object' && hop(data, '$error')) {
//           const error = new Error(data.$error.message);

//           error.code = data.$error.code;
//           error.name = data.$error.name;
//           error.stack = data.$error.stack;
//           error.statusCode = data.$error.statusCode;

//           return error;
//       }

//       return data;
//   }

//   invokeOnRemote(remoteMethodId, ...args) {
//       const dfd = new Deferred();
//       const seqId = this.nextSeqId++;

//       this.sendMessage({
//           request: remoteMethodId,
//           args,
//           seqId,
//       });

//       this.remoteInvocations.set(seqId, dfd);

//       return dfd.promise;
//   }

//   onMessage(data) {
//       if (hop(data, 'methods')) {
//           const remotes = {};

//           for (const key in data.methods) {
//               const remoteMethodId = data.methods[key];

//               remotes[key] = (...args) =>
//                   this.invokeOnRemote(remoteMethodId, ...args);
//           }
//           for (const key in data.props) {
//               remotes[key] = data.props[key];
//           }

//           return this.remoteApiDfd.resolve(remotes);
//       }

//       if (hop(data, 'request')) {
//           const localMethod = this.localMethods.get(data.request);

//           if (!localMethod) {
//               return this.sendMessage({
//                   reject: data.seqId,
//                   result: {
//                       $error: {
//                           message: 'Method not found',
//                       },
//                   },
//               });
//           }

//           try {
//               return Promise.resolve(localMethod(...(data.args || []))).then(
//                   result =>
//                       this.sendMessage({
//                           resolve: data.seqId,
//                           result,
//                       }),
//                   error =>
//                       this.sendMessage({
//                           reject: data.seqId,
//                           result: {
//                               $error: {
//                                   code: error.code,
//                                   message: error.message,
//                                   name: error.name,
//                                   stack: error.stack,
//                                   statusCode: error.statusCode,
//                               },
//                           },
//                       })
//               );
//           } catch (error) {
//               return this.sendMessage({
//                   reject: data.seqId,
//                   result: {
//                       $error: {
//                           code: error.code,
//                           message: error.message,
//                           name: error.name,
//                           stack: error.stack,
//                           statusCode: error.statusCode,
//                       },
//                   },
//               });
//           }
//       }

//       if (hop(data, 'reject')) {
//           const dfd = this.remoteInvocations.get(data.reject);

//           if (!dfd) {
//               if (this.showWarnings) {
//                   // eslint-disable-next-line no-console
//                   console.warn('Received an unexpected rejection', data);
//               }
//               return;
//           }

//           return dfd.reject(this.hydrateResult(data.result));
//       }

//       if (hop(data, 'resolve')) {
//           const dfd = this.remoteInvocations.get(data.resolve);

//           if (!dfd) {
//               if (this.showWarnings) {
//                   // eslint-disable-next-line no-console
//                   console.warn('Received an unexpected resolution', data);
//               }
//               return;
//           }

//           return dfd.resolve(this.hydrateResult(data.result));
//       }
//   }

//   sendApi(rpc) {
//       const methods = {};
//       const props = {};

//       for (const key in rpc) {
//           if (typeof rpc[key] === 'function') {
//               const id = this.nextSeqId++;
//               methods[key] = id;
//               this.localMethods.set(id, rpc[key]);
//           } else {
//               props[key] = rpc[key];
//           }
//       }

//       return this.sendMessage({ methods, props });
//   }
// }

// function trySendMessage(sendMessage) {
//   return function(message) {
//       try {
//           return sendMessage(message);
//       } catch (e) {
//           return Promise.reject(e);
//       }
//   };
// }
