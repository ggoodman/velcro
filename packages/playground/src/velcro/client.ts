import { IDisposable } from '@velcro/common';
import { isRight } from 'fp-ts/lib/Either';
import { VelcroBuilder } from './builder';
import { Events } from './events';
import { FSM, OnEventHandlerContext } from './fsm';
import { Client, Server } from './messages';
import { States } from './states';

type SourceMapOption = 'data-uri' | 'none' | 'string';

function disposableTimer(cb: (...args: any[]) => any, duration?: number): IDisposable {
  const handle = setTimeout(cb, duration);

  return {
    dispose() {
      clearTimeout(handle);
    },
  };
}

export interface VelcroBuilderClientOptions {
  generateSourceMaps?: SourceMapOption;
  throttleBuildTimeout?: number;
}

export class VelcroBuilderClient extends FSM<States, Events> implements VelcroBuilder {
  private sourceMapConfiguration: SourceMapOption;
  private throttleBuildTimeout: number;
  private worker = new Worker('./worker', { type: 'module' });

  constructor(options: VelcroBuilderClientOptions = {}) {
    super(
      {
        // No matter what state we're in, these event handlers should apply
        onEvent: {
          file_create: (ctx) => this.onFileCreate(ctx),
          file_remove: (ctx) => this.onFileRemove(ctx),
          file_update: (ctx) => this.onFileUpdate(ctx),
          start_build: (ctx) => this.onStartBuild(ctx),
        },
        states: {
          idle: {},
          dirty_reset: {
            onEnter: ({ event, transitionTo }) => transitionTo({ stateName: 'dirty' }, event),
          },
          dirty: {
            onEnter: ({ registerDisposable, sendEvent }) =>
              registerDisposable(
                disposableTimer(() => sendEvent('timer_fired'), this.throttleBuildTimeout)
              ),
            onEvent: {
              timer_fired: ({ sendEvent }) =>
                sendEvent('start_build', {
                  entrypoints: [],
                  generateSourceMap: this.sourceMapConfiguration,
                }),
            },
          },
          build_in_progress: {
            onEvent: {
              build_progress: ({ event, state, transitionTo }) =>
                transitionTo(
                  { stateName: 'build_in_progress', data: { ...state.data, ...event.data } },
                  event
                ),
              build_error: ({ event, transitionTo }) =>
                transitionTo({ stateName: 'build_error', data: event.data }, event),
              build_complete: ({ event, transitionTo }) =>
                transitionTo({ stateName: 'build_complete', data: event.data }, event),
            },
          },
          build_complete: {},
          build_error: {},
        },
      },
      { stateName: 'idle' }
    );

    this.sourceMapConfiguration = options.generateSourceMaps || 'none';
    this.throttleBuildTimeout = options.throttleBuildTimeout || 200;

    this.worker.addEventListener('message', (e) => {
      const decoded = Server.AnyEvent.decode(e.data);

      if (!isRight(decoded)) return;
      const event = decoded.right;

      switch (event.eventName) {
        case 'build_progress':
          this.sendEvent('build_progress', event.data);
          break;
        case 'build_complete':
          this.sendEvent('build_complete', event.data);
          break;
        case 'build_error':
          this.sendEvent('build_error', event.data);
          break;
      }
    });
  }

  private onFileCreate({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'file_create'>) {
    // TODO: Update internal bookkeeping
    this.worker.postMessage(
      Client.FileCreateEvent.encode({
        event: 'file_create',
        ...event.data,
      })
    );
    transitionTo({ stateName: 'dirty_reset' }, event);
  }

  private onFileRemove({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'file_remove'>) {
    // TODO: Update internal bookkeeping
    this.worker.postMessage(
      Client.FileRemoveEvent.encode({
        event: 'file_remove',
        ...event.data,
      })
    );
    transitionTo({ stateName: 'dirty_reset' }, event);
  }

  private onFileUpdate({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'file_update'>) {
    // TODO: Update internal bookkeeping
    this.worker.postMessage(
      Client.FileUpdateEvent.encode({
        event: 'file_update',
        ...event.data,
      })
    );
    transitionTo({ stateName: 'dirty_reset' }, event);
  }

  private onStartBuild({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'start_build'>) {
    this.worker.postMessage(
      Client.StartBuildEvent.encode({
        event: 'start_build',
        ...event.data,
      })
    );
    transitionTo(
      {
        stateName: 'build_in_progress',
        data: {
          generateSourceMap: event.data.generateSourceMap,
          completed: 0,
          pending: 0,
          start: Date.now(),
        },
      },
      event
    );
  }

  setGenerateSourceMaps(generateSourceMaps: SourceMapOption) {
    if (this.sourceMapConfiguration !== generateSourceMaps) {
      this.sourceMapConfiguration = generateSourceMaps;

      this.sendEvent('start_build', {
        entrypoints: [],
        generateSourceMap: this.sourceMapConfiguration,
      });
    }
  }
}
