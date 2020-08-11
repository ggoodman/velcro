import { GraphBuilder } from '@velcro/bundler';
import { CancellationTokenSource, Uri } from '@velcro/common';
import { cssPlugin } from '@velcro/plugin-css';
import { sucrasePlugin } from '@velcro/plugin-sucrase';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';
import { VelcroBuilder } from './builder';
import { Events } from './events';
import { FSM, OnEventHandlerContext } from './fsm';
import { sveltePlugin } from './plugins/svelte';
import { States } from './states';
import { readUrl } from './util';

export class VelcroBuilderServer extends FSM<States, Events> implements VelcroBuilder {
  private readonly localStrategy = new MemoryStrategy({}, Uri.file('/'));
  private readonly npmStrategy = CdnStrategy.forJsDelivr(readUrl);
  private readonly rootStrategy = new CompoundStrategy({
    strategies: [this.localStrategy, this.npmStrategy],
  });
  private readonly resolver: Resolver;
  private readonly graphBuilder: GraphBuilder;

  constructor() {
    super(
      {
        onEvent: {
          file_create: (ctx) => this.onFileCreate(ctx),
          file_remove: (ctx) => this.onFileRemove(ctx),
          file_update: (ctx) => this.onFileUpdate(ctx),
          start_build: ({ event, transitionTo }) =>
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
            ),
        },
        states: {
          idle: {},
          dirty_reset: {},
          dirty: {},
          build_in_progress: {
            onEnter: ({ registerDisposable, sendEvent, state }) => {
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
                build.onCompleted(({ graph }) => {
                  const [chunk] = graph.splitChunks();
                  const build = chunk.buildForStaticRuntime({ injectRuntime: true });

                  let sourceMap = '';

                  switch (state.data.generateSourceMap) {
                    case 'data-uri':
                      sourceMap = build.sourceMapDataUri;
                      break;
                    case 'string':
                      sourceMap = build.sourceMapString;
                      break;
                  }

                  sendEvent('build_complete', {
                    code: build.code,
                    sourceMap,
                    start,
                    end: Date.now(),
                  });
                })
              );
              registerDisposable(
                build.onProgress(({ progress }) =>
                  sendEvent('build_progress', { start, ...progress })
                )
              );
              registerDisposable(
                build.onError(({ error }) => {
                  return sendEvent('build_error', { error: error.message, start, end: Date.now() });
                })
              );

              this.graphBuilder.build([this.localStrategy.rootUri], {
                incremental: false,
                token: tokenSource.token,
              });
            },
            onEvent: {
              build_progress: ({ event, state, transitionTo }) =>
                transitionTo(
                  { stateName: 'build_in_progress', data: { ...state.data, ...event.data } },
                  event
                ),
              build_complete: ({ event, state, transitionTo }) =>
                transitionTo({ stateName: 'build_complete', data: event.data }, event),
              build_error: ({ event, state, transitionTo }) =>
                transitionTo({ stateName: 'build_error', data: event.data }, event),
            },
          },
          build_complete: {},
          build_error: {},
        },
      },
      { stateName: 'idle' }
    );

    this.resolver = new Resolver(this.rootStrategy, {
      debug: false,
      extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '.mjs', '.cjs'],
      packageMain: ['browser', 'main'],
    });
    this.graphBuilder = new GraphBuilder({
      resolver: this.resolver,
      nodeEnv: 'development',
      plugins: [
        cssPlugin(),
        sveltePlugin(),
        sucrasePlugin({ transforms: ['imports', 'jsx', 'typescript'] }),
      ],
    });
  }

  private onFileCreate({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'file_create'>) {
    const uri = Uri.parse(event.data.href);

    if (!Uri.isPrefixOf(this.localStrategy.rootUri, uri)) {
      return false;
    }

    this.localStrategy.addFile(uri.fsPath, event.data.content);
    this.graphBuilder.invalidate(uri);
    this.graphBuilder.invalidate(Uri.joinPath(uri, '..'));

    transitionTo({ stateName: 'dirty' }, event);
  }

  private onFileRemove({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'file_remove'>) {
    const uri = Uri.parse(event.data.href);

    if (!Uri.isPrefixOf(this.localStrategy.rootUri, uri)) {
      return false;
    }

    this.localStrategy.removeFile(uri.fsPath);
    this.graphBuilder.invalidate(uri);
    this.graphBuilder.invalidate(Uri.joinPath(uri, '..'));

    transitionTo({ stateName: 'dirty' }, event);
  }

  private onFileUpdate({
    event,
    transitionTo,
  }: OnEventHandlerContext<States, Events, 'file_update'>) {
    const uri = Uri.parse(event.data.href);

    if (!Uri.isPrefixOf(this.localStrategy.rootUri, uri)) {
      return false;
    }

    this.localStrategy.addFile(uri.fsPath, event.data.content, { overwrite: true });
    this.graphBuilder.invalidate(uri);

    transitionTo({ stateName: 'dirty' }, event);
  }
}
