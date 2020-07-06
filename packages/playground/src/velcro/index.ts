import { Graph, GraphBuilder } from '@velcro/bundler';
import { CancellationTokenSource, DisposableStore, Emitter, Event, Uri } from '@velcro/common';
import { cssPlugin } from '@velcro/plugin-css';
import { sucrasePlugin } from '@velcro/plugin-sucrase';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';
import * as Monaco from 'monaco-editor';

const readUrl = (href: string) => fetch(href).then((res) => res.arrayBuffer());

type DefineEvent<TEventName extends string, TData = never> = {
  eventName: TEventName;
  data: TData;
};
type AnyEvent = DefineEvent<string, unknown>;
type EventWithData<TEvent extends AnyEvent> = TEvent extends AnyEvent
  ? [TEvent['data']] extends [never]
    ? never
    : TEvent
  : never;
type EventWithoutData<TEvent extends AnyEvent> = Exclude<TEvent, EventWithData<TEvent>>;

type DefineState<TStateName extends string, TData = never> = TStateName extends string
  ? [TData] extends [never]
    ? {
        stateName: TStateName;
      }
    : {
        stateName: TStateName;
        data: TData;
      }
  : never;
type AnyState = DefineState<string, unknown>;

type BuilderState =
  | DefineState<'initial'>
  | DefineState<'dirty'>
  | DefineState<'waiting'>
  | DefineState<'building', { pending: number; completed: number }>
  | DefineState<'built', { graph: Graph; latency: number }>
  | DefineState<'error', { error: Error; latency: number }>;

type BuilderEvent =
  | DefineEvent<'build'>
  | DefineEvent<'change', { uri: Uri }>
  | DefineEvent<'timer_fired'>
  | DefineEvent<'build_error', { error: Error; start: number }>
  | DefineEvent<'build_progress', { pending: number; completed: number }>
  | DefineEvent<'build_complete', { graph: Graph; start: number }>;

export class VelcroMonaco {
  private readonly disposer = new DisposableStore();
  private readonly fsm: {
    states: {
      [TStateName in BuilderState['stateName']]: {
        onEnter?(ctx: {
          event: BuilderEvent;
          state: Extract<BuilderState, { stateName: TStateName }>;
        }): void;
        onEvent?: {
          [TEventName in BuilderEvent['eventName']]?: (ctx: {
            event: Extract<BuilderEvent, { eventName: TEventName }>;
            state: Extract<BuilderState, { stateName: TStateName }>;
          }) => void;
        };
        onExit?(ctx: {
          event: BuilderEvent;
          state: Extract<BuilderState, { stateName: TStateName }>;
        }): void;
      };
    };
  } = {
    states: {
      initial: {
        onEvent: {
          build: ({ event }) =>
            this.transitionTo({ stateName: 'building', data: { pending: 0, completed: 0 } }, event),
          change: ({ event }) => this.transitionTo({ stateName: 'dirty' }, event),
        },
      },
      dirty: {
        onEnter: ({ event }) => {
          if (event.eventName === 'change') {
            // Mark the uri as invalidated so that any source files or dependencies
            // that relied on that uri are also invalidated.
            this.graphBuilder.invalidate(event.data.uri);

            // Also invalidate the containing directory in case some resolutions
            // might have relied on the contents of that directory. We don't need
            // to walk up the tree though, since only the contents of the immediate
            // parent might have changed.
            // const parentUri = Uri.joinPath(event.data.uri, '..');
            // if (!Uri.equals(event.data.uri, parentUri)) {
            //   this.graphBuilder.invalidate(Uri.ensureTrailingSlash(parentUri));
            // }
          }

          if (this.buildConfig.autoBuild) {
            this.transitionTo({ stateName: 'waiting' }, event);
          }
        },
        onEvent: {
          build: ({ event }) =>
            this.transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
        },
      },
      waiting: {
        onEnter: () => {
          const timerHandle = setTimeout(() => {
            this.sendEvent('timer_fired');
          }, this.buildConfig.autoBuildWaitTimeout);

          this.stateDisposer.add({
            dispose: () => {
              clearTimeout(timerHandle);
            },
          });
        },
        onEvent: {
          build: ({ event }) =>
            this.transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          change: ({ event }) => this.transitionTo({ stateName: 'dirty' }, event),
          timer_fired: ({ event }) =>
            this.transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
        },
      },
      building: {
        onEnter: () => {
          const tokenSource = new CancellationTokenSource();
          const start = Date.now();
          const build = this.graphBuilder.build([this.localStrategy.rootUri], {
            incremental: false,
            token: tokenSource.token,
          });

          this.stateDisposer.add({
            dispose() {
              tokenSource.dispose(true);
            },
          });
          this.stateDisposer.add(
            build.onCompleted(({ graph }) => this.sendEvent('build_complete', { graph, start }))
          );
          this.stateDisposer.add(
            build.onProgress(({ progress }) => this.sendEvent('build_progress', progress))
          );
          this.stateDisposer.add(
            build.onError(({ error }) => {
              return this.sendEvent('build_error', { error, start });
            })
          );

          this.graphBuilder.build([this.localStrategy.rootUri], {
            incremental: false,
            token: tokenSource.token,
          });
        },
        onEvent: {
          build_complete: ({ event }) =>
            this.transitionTo(
              {
                stateName: 'built',
                data: { graph: event.data.graph, latency: Date.now() - event.data.start },
              },
              event
            ),
          build_error: ({ event }) =>
            this.transitionTo(
              {
                stateName: 'error',
                data: { error: event.data.error, latency: Date.now() - event.data.start },
              },
              event
            ),
          build_progress: ({ event }) =>
            this.transitionTo(
              {
                stateName: 'building',
                data: { completed: event.data.completed, pending: event.data.pending },
              },
              event
            ),
          change: ({ event }) => this.transitionTo({ stateName: 'dirty' }, event),
        },
      },
      built: {
        onEvent: {
          build: ({ event }) =>
            this.transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          change: ({ event }) => this.transitionTo({ stateName: 'dirty' }, event),
        },
      },
      error: {
        onEvent: {
          build: ({ event }) =>
            this.transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          change: ({ event }) => this.transitionTo({ stateName: 'dirty' }, event),
        },
      },
    },
  };

  private readonly onStateChangeEmitter = new Emitter<Readonly<BuilderState>>();

  private readonly localStrategy = new MemoryStrategy({}, Uri.file('/'));
  private readonly npmStrategy = CdnStrategy.forJsDelivr(readUrl);
  private readonly rootStrategy = new CompoundStrategy({
    strategies: [this.localStrategy, this.npmStrategy],
  });
  private readonly resolver: Resolver;
  private readonly graphBuilder: GraphBuilder;

  private mutableBuildState: BuilderState = { stateName: 'initial' };

  public readonly buildConfig = {
    autoBuild: false,
    autoBuildWaitTimeout: 500,
  };

  private pendingEvents: BuilderEvent[] = [];

  sendEvent<TSentEvent extends EventWithoutData<BuilderEvent>>(
    event: TSentEvent['eventName']
  ): void;
  sendEvent<TSentEvent extends EventWithData<BuilderEvent>>(
    event: TSentEvent['eventName'],
    data: TSentEvent['data']
  ): void;
  sendEvent<TSentEvent extends BuilderEvent>(
    eventName: TSentEvent['eventName'],
    data?: TSentEvent['data']
  ): void {
    // console.group();
    // console.log('sendEvent(%s, %s)', this.state.stateName, eventName, data);
    this.pendingEvents.push({ eventName, data } as BuilderEvent);

    while (this.pendingEvents.length) {
      const event = this.pendingEvents.shift()!;
      const currentStateDef = this.fsm.states[this.mutableBuildState.stateName];

      // console.group();
      // console.log('sendEvent(%s, %s) handle(%s)', this.state.stateName, eventName, event.eventName);

      if (currentStateDef.onEvent) {
        const handler = currentStateDef.onEvent[event.eventName];
        const state = this.state;

        if (handler) {
          handler({ event, state } as any);
        }
      }
      // console.groupEnd();
    }
    // console.groupEnd();
  }

  private readonly stateDisposer = new DisposableStore();

  transitionTo<TTargetState extends BuilderState, TTriggeringEvent extends BuilderEvent>(
    state: TTargetState,
    event: TTriggeringEvent
  ) {
    // console.log('transitionTo(%s, %s, %s)', this.state.stateName, state.stateName, event.eventName);
    // console.group();
    const nextStateConfig = this.fsm.states[state.stateName];
    const fromState = { ...this.mutableBuildState };

    this.mutableBuildState = { ...state };
    this.onStateChangeEmitter.fire(this.state);

    if (state.stateName !== fromState.stateName) {
      this.stateDisposer.clear();

      if (nextStateConfig.onEnter) {
        // console.log('onEnter(%s, %s)', this.state.stateName, event.eventName);
        // console.group();
        nextStateConfig.onEnter({ event, state } as any);
        // console.groupEnd();
      }
    }
    // console.groupEnd();
  }

  constructor(
    monaco: typeof import('monaco-editor'),
    options: { autoBuild?: boolean; autoBuildWaitTimeout?: number } = {}
  ) {
    if (options.autoBuild) {
      this.buildConfig.autoBuild = options.autoBuild;
    }
    if (options.autoBuildWaitTimeout) {
      this.buildConfig.autoBuildWaitTimeout = options.autoBuildWaitTimeout;
    }

    this.resolver = new Resolver(this.rootStrategy, {
      debug: false,
      extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '.mjs', '.cjs'],
      packageMain: ['browser', 'main'],
    });
    this.graphBuilder = new GraphBuilder({
      resolver: this.resolver,
      nodeEnv: 'development',
      plugins: [cssPlugin(), sucrasePlugin({ transforms: ['imports', 'jsx', 'typescript'] })],
    });

    this.disposer.add(this.resolver);
    // this.disposer.add(this.graphBuilder);

    // Track existing models
    for (const model of monaco.editor.getModels()) {
      if (!Uri.isPrefixOf(this.localStrategy.rootUri, model.uri)) {
        continue;
      }

      this.trackModel(model);
    }

    // And future models
    monaco.editor.onDidCreateModel((model) => {
      if (!Uri.isPrefixOf(this.localStrategy.rootUri, model.uri)) {
        return;
      }

      this.trackModel(model);
    });
  }

  get onStateChange(): Event<Readonly<BuilderState>> {
    return this.onStateChangeEmitter.event;
  }

  get state(): Readonly<BuilderState> {
    return this.mutableBuildState;
  }

  dispose() {
    this.disposer.dispose();
  }

  startBuild() {
    this.sendEvent('build');
  }

  private handleChange(uri: Uri) {
    this.sendEvent('change', { uri });
  }

  private trackModel(model: Monaco.editor.ITextModel) {
    model.onWillDispose(() => {
      this.localStrategy.removeFile(model.uri.fsPath);
      this.handleChange(Uri.from(model.uri));
      disposerReference.dispose();
    });

    this.localStrategy.addFile(model.uri.fsPath, model.getValue());

    const disposerReference = this.disposer.add(
      model.onDidChangeContent(() => {
        this.localStrategy.addFile(model.uri.fsPath, model.getValue(), {
          overwrite: true,
        });
        this.handleChange(Uri.from(model.uri));
      })
    );

    this.handleChange(Uri.from(model.uri));
  }
}
