import { Event, IDisposable } from '@velcro/common';
import { isRight } from 'fp-ts/Either';
import { VelcroBuilder } from './builder';
import { Client, Server } from './messages';

export interface WorkerLike {
  addEventListener(
    type: 'message',
    listener: (this: WorkerGlobalScope, ev: MessageEvent) => any
  ): void;
  removeEventListener(
    type: string,

    listener: (...args: any[]) => any
  ): void;
  postMessage(message: any): void;
}

function wireClientEvents(event: Event<unknown>, builder: VelcroBuilder) {
  return event((msg) => {
    const decoded = Client.Any.decode(msg);
    if (!isRight(decoded)) return;

    const event = decoded.right;

    switch (event.event) {
      case 'file_create':
        builder.sendEvent('file_create', {
          content: event.content,
          href: event.href,
        });
        break;
      case 'file_remove':
        builder.sendEvent('file_remove', { href: event.href });
        break;
      case 'file_update':
        builder.sendEvent('file_update', {
          content: event.content,
          href: event.href,
        });
        break;
      case 'start_build':
        builder.sendEvent('start_build', {
          entrypoints: event.entrypoints,
          generateSourceMap: event.generateSourceMap,
        });
        break;
    }
  });
}

/**
 * Wire a Worker's 'message' events up with a VelcroBuilder instance
 *
 * @param worker The worker on which to listen for client events
 * @param server The Velcro server instance to which those events will be delegated
 */
export function wireWorkerEventsToServer(worker: WorkerLike, server: VelcroBuilder): IDisposable {
  return wireClientEvents(
    Event.fromDOMEventEmitter(worker, 'message', (event) => event.data),
    server
  );
}

/**
 *
 * @param builder The Velcro server instance that is executing builds
 * @param worker The worker whose postMessage channel should be used for communicating back to the client
 * @param debounceInterval The minimum interval at which state changes will be passed back to the client
 */
export function wireBuilderStateChanges(
  builder: VelcroBuilder,
  worker: WorkerLike,
  options: {
    debounceInterval?: number;
  } = {}
): IDisposable {
  const stateChangeEvent = options.debounceInterval
    ? Event.debounce(builder.onStateChange, (_, e) => e, 16)
    : builder.onStateChange;

  return stateChangeEvent((state) => {
    switch (state.stateName) {
      case 'build_in_progress': {
        return worker.postMessage(
          Server.BuildProgress.encode({
            eventName: 'build_progress',
            data: state.data,
          })
        );
      }
      case 'build_complete': {
        return worker.postMessage(
          Server.BuildComplete.encode({
            eventName: 'build_complete',
            data: state.data,
          })
        );
      }
      case 'build_error': {
        return worker.postMessage(
          Server.BuildError.encode({
            eventName: 'build_error',
            data: state.data,
          })
        );
      }
    }
  });
}
