/* eslint-env worker */

import { Graph, GraphBuilder } from '@velcro/bundler';
import { CancellationTokenSource, DisposableStore, Event, Uri } from '@velcro/common';
import { cssPlugin } from '@velcro/plugin-css';
import { sucrasePlugin } from '@velcro/plugin-sucrase';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';
import { DefineEvent, DefineState, FSM } from './fsm';
import { BuildingState, BuiltState, EditorEvents, ErrorState } from './types';
// import * as Monaco from 'monaco-editor';

const readUrl = (href: string) => fetch(href).then((res) => res.arrayBuffer());

type BuilderState =
  | DefineState<'initial'>
  | DefineState<'dirty'>
  | DefineState<'waiting'>
  | DefineState<'building', { pending: number; completed: number }>
  | DefineState<'built', { graph: Graph; latency: number }>
  | DefineState<'error', { error: Error; latency: number }>;

type FileCreateEvent = DefineEvent<'file_create', { uri: Uri; content: string }>;
type FileRemoveEvent = DefineEvent<'file_remove', { uri: Uri }>;
type FileUpdateEvent = DefineEvent<'file_update', { uri: Uri; content: string }>;
type BuilderEvent =
  | DefineEvent<'build'>
  | FileCreateEvent
  | FileRemoveEvent
  | FileUpdateEvent
  | DefineEvent<'timer_fired'>
  | DefineEvent<'build_error', { error: Error; start: number }>
  | DefineEvent<'build_progress', { pending: number; completed: number }>
  | DefineEvent<'build_complete', { graph: Graph; start: number }>;

export class VelcroBuilderMachine {
  private readonly disposer = new DisposableStore();
  private readonly fsm = new FSM<BuilderState, BuilderEvent>(
    {
      initial: {
        onEvent: {
          build: ({ event, transitionTo }) =>
            transitionTo({ stateName: 'building', data: { pending: 0, completed: 0 } }, event),
          file_create: ({ event, transitionTo }) => {
            if (this.onFileCreate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_remove: ({ event, transitionTo }) => {
            if (this.onFileRemove(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_update: ({ event, transitionTo }) => {
            if (this.onFileUpdate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
        },
      },
      dirty: {
        onEnter: ({ event, transitionTo }) => {
          if (this.buildConfig.autoBuild) {
            transitionTo({ stateName: 'waiting' }, event);
          }
        },
        onEvent: {
          build: ({ event, transitionTo }) =>
            transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          file_create: ({ event, transitionTo }) => {
            if (this.onFileCreate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_remove: ({ event, transitionTo }) => {
            if (this.onFileRemove(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_update: ({ event, transitionTo }) => {
            if (this.onFileUpdate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
        },
      },
      waiting: {
        onEnter: ({ registerDisposable, sendEvent }) => {
          const timerHandle = setTimeout(() => {
            sendEvent('timer_fired');
          }, this.buildConfig.autoBuildWaitTimeout);

          registerDisposable({
            dispose: () => {
              clearTimeout(timerHandle);
            },
          });
        },
        onEvent: {
          build: ({ event, transitionTo }) =>
            transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          file_create: ({ event, transitionTo }) => {
            if (this.onFileCreate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_remove: ({ event, transitionTo }) => {
            if (this.onFileRemove(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_update: ({ event, transitionTo }) => {
            if (this.onFileUpdate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          timer_fired: ({ event, transitionTo }) =>
            transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
        },
      },
      building: {
        onEnter: ({ registerDisposable, sendEvent }) => {
          const tokenSource = new CancellationTokenSource();
          const start = Date.now();
          const build = this.graphBuilder.build([this.localStrategy.rootUri], {
            incremental: false,
            token: tokenSource.token,
          });

          registerDisposable({
            dispose() {
              tokenSource.dispose(true);
            },
          });
          registerDisposable(
            build.onCompleted(({ graph }) => sendEvent('build_complete', { graph, start }))
          );
          registerDisposable(
            build.onProgress(({ progress }) => sendEvent('build_progress', progress))
          );
          registerDisposable(
            build.onError(({ error }) => {
              return sendEvent('build_error', { error, start });
            })
          );

          this.graphBuilder.build([this.localStrategy.rootUri], {
            incremental: false,
            token: tokenSource.token,
          });
        },
        onEvent: {
          build_complete: ({ event, transitionTo }) =>
            transitionTo(
              {
                stateName: 'built',
                data: { graph: event.data.graph, latency: Date.now() - event.data.start },
              },
              event
            ),
          build_error: ({ event, transitionTo }) =>
            transitionTo(
              {
                stateName: 'error',
                data: { error: event.data.error, latency: Date.now() - event.data.start },
              },
              event
            ),
          build_progress: ({ event, transitionTo }) =>
            transitionTo(
              {
                stateName: 'building',
                data: { completed: event.data.completed, pending: event.data.pending },
              },
              event
            ),
          file_create: ({ event, transitionTo }) => {
            if (this.onFileCreate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_remove: ({ event, transitionTo }) => {
            if (this.onFileRemove(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_update: ({ event, transitionTo }) => {
            if (this.onFileUpdate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
        },
      },
      built: {
        onEvent: {
          build: ({ event, transitionTo }) =>
            transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          file_create: ({ event, transitionTo }) => {
            if (this.onFileCreate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_remove: ({ event, transitionTo }) => {
            if (this.onFileRemove(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_update: ({ event, transitionTo }) => {
            if (this.onFileUpdate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
        },
      },
      error: {
        onEvent: {
          build: ({ event, transitionTo }) =>
            transitionTo({ stateName: 'building', data: { completed: 0, pending: 0 } }, event),
          file_create: ({ event, transitionTo }) => {
            if (this.onFileCreate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_remove: ({ event, transitionTo }) => {
            if (this.onFileRemove(event)) transitionTo({ stateName: 'dirty' }, event);
          },
          file_update: ({ event, transitionTo }) => {
            if (this.onFileUpdate(event)) transitionTo({ stateName: 'dirty' }, event);
          },
        },
      },
    },
    { stateName: 'initial' }
  );

  private readonly localStrategy = new MemoryStrategy({}, Uri.file('/'));
  private readonly npmStrategy = CdnStrategy.forJsDelivr(readUrl);
  private readonly rootStrategy = new CompoundStrategy({
    strategies: [this.localStrategy, this.npmStrategy],
  });
  private readonly resolver: Resolver;
  private readonly graphBuilder: GraphBuilder;

  public readonly buildConfig = {
    autoBuild: false,
    autoBuildWaitTimeout: 500,
  };

  constructor(options: { autoBuild?: boolean; autoBuildWaitTimeout?: number } = {}) {
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
  }

  get onStateChange() {
    return this.fsm.onStateChange;
  }

  get sendEvent() {
    return this.fsm.sendEvent.bind(this.fsm);
  }

  get state() {
    return this.fsm.state;
  }

  dispose() {
    this.disposer.dispose();
  }

  startBuild() {
    this.fsm.sendEvent('build');
  }

  private onFileCreate(e: FileCreateEvent) {
    if (!Uri.isPrefixOf(this.localStrategy.rootUri, e.data.uri)) {
      return false;
    }

    this.localStrategy.addFile(e.data.uri.fsPath, e.data.content, { overwrite: true });
    this.graphBuilder.invalidate(e.data.uri);
    this.graphBuilder.invalidate(Uri.joinPath(e.data.uri, '..'));

    return true;
  }

  private onFileRemove(e: FileRemoveEvent) {
    if (!Uri.isPrefixOf(this.localStrategy.rootUri, e.data.uri)) {
      return false;
    }

    this.localStrategy.removeFile(e.data.uri.fsPath);
    this.graphBuilder.invalidate(e.data.uri);
    this.graphBuilder.invalidate(Uri.joinPath(e.data.uri, '..'));

    return true;
  }

  private onFileUpdate(e: FileUpdateEvent) {
    if (!Uri.isPrefixOf(this.localStrategy.rootUri, e.data.uri)) {
      return false;
    }

    this.localStrategy.addFile(e.data.uri.fsPath, e.data.content, { overwrite: true });
    this.graphBuilder.invalidate(e.data.uri);

    return true;
  }
}

const builder = new VelcroBuilderMachine({
  autoBuild: true,
  autoBuildWaitTimeout: 500,
});

globalThis.addEventListener('message', (e) => {
  const data = e.data;

  if (EditorEvents.is(data)) {
    for (const event of data) {
      switch (event.event) {
        case 'file_create':
          builder.sendEvent('file_create', {
            content: event.content,
            uri: Uri.parse(event.href),
          });
          break;
        case 'file_remove':
          builder.sendEvent('file_remove', { uri: Uri.parse(event.href) });
          break;
        case 'file_update':
          builder.sendEvent('file_update', {
            content: event.content,
            uri: Uri.parse(event.href),
          });
          break;
      }
    }
  }
});

Event.debounce(
  builder.onStateChange,
  (_, e) => e,
  16
)((state) => {
  switch (state.stateName) {
    case 'building': {
      const message: BuildingState = {
        state: 'building',
        completed: state.data.completed,
        pending: state.data.pending,
      };
      return globalThis.postMessage(message);
    }
    case 'built': {
      const graph = state.data.graph;
      const [chunk] = graph.splitChunks();
      const build = chunk.buildForStaticRuntime({
        injectRuntime: true,
      });
      const codeWithStart = `${build.code}\n\n${[Uri.file('/index.jsx')]
        .map((entrypoint) => `Velcro.runtime.require(${JSON.stringify(entrypoint.toString())});`)
        .join('\n')}\n`;
      const runtimeCode = `${codeWithStart}\n//# sourceMappingURL=${build.sourceMapDataUri}`;
      const codeBundleFile = new File([runtimeCode], Uri.file('/index.jsx').toString(), {
        type: 'text/javascript',
      });

      const markup = new File(
        [
          `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="ie=edge">
<script src="https://cdn.jsdelivr.net/npm/panic-overlay/build/panic-overlay.browser.js"></script>
<title>Document</title>
</head>
<body>
<div id="root"></div>
<script src="${URL.createObjectURL(codeBundleFile)}"></script>
<script>
  panic.configure ({
    stackEntryClicked (entry) {
      if (window.parent) {
        window.parent.postMessage({
          event: 'click_error',
          entry: {
            column: entry.column,
            file: entry.file,
            line: entry.line,
          }
        });
      }
    }
  })
</script>
</body>
</html>`.trim(),
        ],
        Uri.file('/index.html').toString(),
        {
          type: 'text/html',
        }
      );
      const htmlUrl = URL.createObjectURL(markup);
      const message: BuiltState = {
        state: 'built',
        href: htmlUrl,
      };

      return globalThis.postMessage(message);
    }
    case 'error': {
      const message: ErrorState = {
        state: 'error',
        error: { message: state.data.error.message },
      };

      return globalThis.postMessage(message);
    }
  }
});
