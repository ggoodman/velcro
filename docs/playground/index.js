//@ts-check

/** @type {import('angular')} */
const Angular = window['angular'];

/** @type {import('../../packages/bundler') & import('../../packages/resolver') & import('../../packages/resolver-host-compound') & import('../../packages/resolver-host-memory') & import('../../packages/resolver-host-unpkg')} */
// @ts-ignore
const Velcro = window['Velcro'];

/** @type {import('monaco-editor/dev/vs/loader')} */
// @ts-ignore
const Loader = window['require'];

/** @type {import('idb')} */
const { openDB } = window['idb'];

Loader.config({ paths: { vs: 'https://unpkg.com/monaco-editor/min/vs' } });
Loader(['vs/editor/editor.main'], function() {
  /** @type {import('monaco-editor')} */
  const Monaco = window['monaco'];

  Monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  Monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    experimentalDecorators: true,
    isolatedModules: false,
    jsx: Monaco.languages.typescript.JsxEmit.React,
    jsxFactory: 'React.createElement',
    module: Monaco.languages.typescript.ModuleKind.CommonJS,
    moduleResolution: Monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: false,
    outDir: `dist`,
    rootDir: `/`,
    sourceMap: true,
    inlineSourceMap: true,
    inlineSources: true,
    target: Monaco.languages.typescript.ScriptTarget.ES2016,
    typeRoots: [`node_modules/@types`],
  });

  class CachingHost extends Velcro.Resolver.Host {
    /**
     *
     * @param {import('../../packages/resolver').Resolver.Host} host
     */
    constructor(host) {
      super();

      this.host = host;
      /** @type {Promise<import('idb').IDBPDatabase | null>} */
      this.idbPromise = openDB('velcro', Velcro.Bundler.schemaVersion, {
        async upgrade(db, oldVersion, newVersion, transaction) {
          console.log('Upgrading cache from version %s to %s', oldVersion, newVersion);

          if (!oldVersion) {
            db.createObjectStore('getCanonicalUrl');
            db.createObjectStore('getResolveRoot');
            db.createObjectStore('listEntries');
            db.createObjectStore('readFileContent');
          }

          await transaction.objectStore('getCanonicalUrl').clear();
          await transaction.objectStore('getResolveRoot').clear();
          await transaction.objectStore('listEntries').clear();
          await transaction.objectStore('readFileContent').clear();
        },
      }).catch(err => {
        console.error(err, 'error opening IndexedDB');

        return null;
      });

      /** @type {Map<string, ReturnType<import('../../packages/resolver').Resolver.Host['getCanonicalUrl']>>} */
      this.inflightGetCanonicalUrl = new Map();
      /** @type {Map<string, ReturnType<import('../../packages/resolver').Resolver.Host['getResolveRoot']>>} */
      this.inflightGetResolveRoot = new Map();
      /** @type {Map<string, ReturnType<import('../../packages/resolver').Resolver.Host['listEntries']>>} */
      this.inflightListEntries = new Map();
      /** @type {Map<string, ReturnType<import('../../packages/resolver').Resolver.Host['readFileContent']>>} */
      this.inflightReadFileContent = new Map();
    }

    /**
     * @template T
     * @template C=unknown
     * @param {string} href
     * @param {() => Promise<T>} loadFn
     * @param {Map<string, Promise<T>>} inflightMap
     * @param {string} storeName
     * @param {(result: T) => C} [serialize]
     * @param {(cached: C) => T} [deserialize]
     * @returns {Promise<T>}
     */
    async withCache(href, loadFn, inflightMap, storeName, serialize, deserialize) {
      let idb = undefined;

      try {
        idb = await this.idbPromise;
      } catch (err) {
        // Error already logged
      }

      if (idb) {
        try {
          const cached = await idb.get(storeName, href);

          if (cached) {
            return deserialize ? deserialize(cached) : cached;
          }
        } catch (err) {
          console.error(err, 'error reading from cache');
        }
      }

      let inflight = inflightMap.get(href);

      if (!inflight) {
        inflight = loadFn();
        inflightMap.set(href, inflight);

        (async () => {
          try {
            const result = await inflight;

            if (idb) {
              try {
                await idb.put(storeName, serialize ? serialize(result) : result, href);
              } catch (err) {
                console.error(err, 'error writing to cache');
              }
            }
          } finally {
            inflightMap.delete(href);
          }
        })();
      }

      return inflight;
    }

    async getCanonicalUrl(resolver, url) {
      const result = await this.withCache(
        url.href,
        () => this.host.getCanonicalUrl(resolver, url),
        this.inflightGetCanonicalUrl,
        'getCanonicalUrl',
        url => url.href,
        href => new URL(href)
      );

      return result;
    }

    async getResolveRoot(resolver, url) {
      const result = await this.withCache(
        url.href,
        () => this.host.getResolveRoot(resolver, url),
        this.inflightGetResolveRoot,
        'getResolveRoot',
        url => url.href,
        href => new URL(href)
      );

      return result;
    }

    async listEntries(resolver, url) {
      const result = await this.withCache(
        url.href,
        () => this.host.listEntries(resolver, url),
        this.inflightListEntries,
        'listEntries',
        entries =>
          entries.map(entry => ({
            type: entry.type,
            href: entry.url.href,
          })),
        cached =>
          cached.map(entry => ({
            type: entry.type,
            url: new URL(entry.href),
          }))
      );

      return result;
    }

    async readFileContent(resolver, url) {
      const result = await this.withCache(
        url.href,
        () => this.host.readFileContent(resolver, url),
        this.inflightReadFileContent,
        'readFileContent'
      );

      return result;
    }
  }

  Angular.module('velcro', []).component('workbench', {
    templateUrl: './components/workbench.html',
    controller: Object.assign(
      class WorkbenchController {
        /**
         *
         * @param {JQLite} $element
         */
        constructor($scope, $element) {
          /** @type {undefined | import('monaco-editor').editor.IStandaloneCodeEditor} */
          this.editor = undefined;
          /** @type {ReturnType<import('angular')['element']>} */
          this.el = $element;
          /** @type {import('angular').IScope} */
          this.scope = $scope;

          this.pendingAssets = 0;
          this.completedAssets = 0;
          /** @type {'ready' | 'building' | 'failed' | 'built'} */
          this.state = 'ready';

          /** @type {WeakMap<import('monaco-editor').editor.ITextModel, import('monaco-editor').editor.ICodeEditorViewState>} */
          this.viewState = new WeakMap();

          const indexUri = Monaco.Uri.file('/index.js');
          Monaco.editor.createModel(
            `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';

import { name } from './name';

class Hello extends Component {
  render() {
    return <div>Hello {this.props.toWhat}</div>;
  }
}

ReactDOM.render(
  <Hello toWhat="World" />,
  document.getElementById('root')
);
            `.trim(),
            'typescript',
            indexUri
          );
          const nameUri = Monaco.Uri.file('/name.js');
          Monaco.editor.createModel(
            `
export const name = 'World';
            `.trim(),
            'typescript',
            nameUri
          );

          const packageJsonUri = Monaco.Uri.file('/package.json');
          Monaco.editor.createModel(
            JSON.stringify(
              {
                name: 'velcro-playground',
                dependencies: {
                  react: '^16.9.0',
                  'react-dom': '^16.9.0',
                },
              },
              null,
              2
            ),
            null,
            packageJsonUri
          );

          const unpkgHost = new Velcro.ResolverHostUnpkg();

          /** @type {import('../../packages/resolver').Resolver.Host} */
          const memoryHostWrapper = new (class extends Velcro.Resolver.Host {
            async getResolveRoot() {
              return new URL('file:///');
            }
            async listEntries() {
              return Monaco.editor.getModels().map(model => {
                return {
                  type: Velcro.ResolvedEntryKind.File,
                  url: new URL(model.uri.toString(true)),
                };
              });
            }

            /**
             *
             * @param {import('../../packages/resolver').Resolver} _resolver
             * @param {URL} url
             */
            async readFileContent(_resolver, url) {
              const encoder = new TextEncoder();
              const uri = Monaco.Uri.file(url.pathname);
              const model = Monaco.editor.getModel(uri);

              if (!model) {
                throw new Error(`No file registered with uri '${url.href}`);
              }

              if (model.getModeId() === 'typescript') {
                const workerFactory = await Monaco.languages.typescript.getTypeScriptWorker();
                const workerClient = await workerFactory(uri);
                const uriStr = uri.toString(true);
                const [emitOutput, syntacticDiagnostics] = await Promise.all([
                  workerClient.getEmitOutput(uriStr),
                  workerClient.getSyntacticDiagnostics(uriStr),
                ]);

                if (emitOutput.emitSkipped) {
                  throw new Error(`Emit skipped when trying to load ${url}`);
                }

                if (syntacticDiagnostics.length) {
                  const err = new Error(
                    `Syntax error: ${syntacticDiagnostics[0].messageText} at ${url.pathname}:${
                      syntacticDiagnostics[0].start
                    }:${syntacticDiagnostics[0].length}`
                  );

                  throw err;
                }

                return encoder.encode(emitOutput.outputFiles[0].text);
              }

              return encoder.encode(model.getValue());
            }
          })();

          const cachedUnpkgHost = new CachingHost(unpkgHost);
          const memoryRoot = Monaco.Uri.file('/').toString(true);
          const resolverHost = new Velcro.ResolverHostCompound({
            ['https://unpkg.com/']: cachedUnpkgHost,
            [memoryRoot]: memoryHostWrapper,
          });
          const resolver = new Velcro.Resolver(resolverHost, {
            packageMain: ['unpkg', 'browser', 'main'],
          });

          this.bundler = new Velcro.Bundler({ resolver });
        }

        $postLink() {
          window.addEventListener(
            'message',
            e => {
              this.showPreviewMessage(`${e.data.payload.name}: ${e.data.payload.message}`, 'error');
            },
            true
          );

          const editorDiv = this.el.children().children()[1];
          const model = Monaco.editor.getModel(Monaco.Uri.file('/index.js'));

          this.editor = Monaco.editor.create(editorDiv, {
            model: null,
            automaticLayout: true,
            showUnused: true,
            scrollBeyondLastLine: false,
          });

          this.editor.onDidChangeModel(e => {
            this.withApply(() => {
              this.activeModel = Monaco.editor.getModel(e.newModelUrl);

              const viewState = this.viewState.get(this.activeModel);

              if (viewState) {
                this.editor.restoreViewState(viewState);
              }
            });
          });

          this.editor.onDidBlurEditorText(() => {
            this.withApply(() => {
              this.focusedModel = undefined;
            });

            this.viewState.set(this.editor.getModel(), this.editor.saveViewState());
          });

          this.editor.onDidFocusEditorText(() => {
            this.withApply(() => {
              this.focusedModel = this.editor.getModel();
            });
          });

          this.editor.setModel(model);
          this.editor.focus();

          Monaco.editor.onDidCreateModel(model => {
            model.onDidChangeContent(e => {
              if (this.refreshPreviewTimer) {
                clearTimeout(this.refreshPreviewTimer);
              }

              this.refreshPreviewTimer = setTimeout(() => this.refreshPreview(), 1000);
            });
          });

          for (const model of Monaco.editor.getModels()) {
            model.onDidChangeContent(e => {
              if (this.refreshPreviewTimer) {
                clearTimeout(this.refreshPreviewTimer);
              }

              this.refreshPreviewTimer = setTimeout(() => this.refreshPreview(), 1000);
            });
          }

          this.refreshPreview();
        }

        getModels() {
          return Monaco.editor.getModels();
        }

        onClickCreate() {
          const pathname = prompt('Filename:');

          if (pathname) {
            const model = Monaco.editor.createModel(
              '',
              pathname.endsWith('.js') ? 'typescript' : null,
              Monaco.Uri.file(pathname)
            );

            this.editor.setModel(model);
            this.editor.focus();
          }
        }

        /**
         *
         * @param {import('monaco-editor').editor.ITextModel} model
         */
        onClickModel(model) {
          if (model) {
            this.editor.setModel(model);
            this.editor.focus();
          }
        }

        showPreviewMessage(message, className) {
          const preview = this.el.children().children()[2];

          if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = undefined;
          }

          this.loadingIndicator = document.createElement('div');
          this.loadingIndicator.classList.add('status', className);
          this.loadingIndicator.textContent = message;

          preview.appendChild(this.loadingIndicator);
        }

        async refreshPreview() {
          const start = Date.now();
          console.time('refreshPreview');

          if (this.refreshPreviewTimer) {
            clearTimeout(this.refreshPreviewTimer);
          }

          this.showPreviewMessage('Rebuilding...', 'info');

          const preview = this.el.children().children()[2];
          const iframe = document.createElement('iframe');

          iframe.classList.add('iframe', 'loading');
          preview.classList.add('loading');

          try {
            const entrypoint = Monaco.Uri.file('/index.js').toString(true);

            this.bundler.remove(entrypoint);

            this.withApply(() => {
              this.pendingAssets = 0;
              this.completedAssets = 0;
              this.state = 'building';
            });

            await this.bundler.add(entrypoint, {
              onCompleteAsset: () => {
                this.withApply(() => {
                  this.completedAssets++;
                });
              },
              onEnqueueAsset: () => {
                this.withApply(() => {
                  this.pendingAssets++;
                });
              },
            });

            const errorWatcher = new File(
              [
                `
window.onerror = function(msg, url, lineNo, columnNo, err) {
  const payload = { url, lineNo, columnNo, name: err.name };
  for (const key of Object.getOwnPropertyNames(err)) {
    payload[key] = err[key];
  }
  window.parent.postMessage({ type: 'error', payload }, '*');
}
            `,
              ],
              'watcher.js',
              {
                type: 'text/javascript',
              }
            );
            const code = this.bundler.generateBundleCode({ entrypoint, sourceMap: true });
            const bundleFile = new File([code], entrypoint, {
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
      <title>Document</title>
      <script src="${URL.createObjectURL(errorWatcher)}"></script>
    </head>
    <body>
      <div id="root"></div>
      <script src="${URL.createObjectURL(bundleFile)}"></script>
    </body>
    </html>`,
              ],
              Monaco.Uri.file('/index.html').toString(true),
              {
                type: 'text/html',
              }
            );
            const htmlUrl = URL.createObjectURL(markup);
            iframe.src = htmlUrl;

            this.withApply(() => {
              this.state = 'built';
              this.buildTime = Date.now() - start;
            });

            preview.appendChild(iframe);

            iframe.onerror = err => {
              this.showPreviewMessage(`Preview failed to load: ${typeof err === 'string' ? err : `<${err.type}>`}`);

              iframe.remove();
              preview.classList.remove('loading');

              this.withApply(() => {
                this.state = 'failed';
              });

              console.timeEnd('refreshPreview');
            };
            iframe.onload = () => {
              if (this.previousIframe) {
                this.previousIframe.remove();
              }

              this.previousIframe = iframe;

              iframe.classList.remove('loading');
              preview.classList.remove('loading');

              if (this.loadingIndicator) {
                this.loadingIndicator.remove();
                this.loadingIndicator = undefined;
              }

              this.withApply(() => {
                this.state = 'ready';
              });

              console.timeEnd('refreshPreview');
            };
          } catch (err) {
            this.showPreviewMessage(`${err.name}: ${err.message}`, 'error');

            this.withApply(() => {
              this.state = 'failed';
            });

            console.timeEnd('refreshPreview');
          }
        }

        withApply(fn) {
          if (this.scope.$root.$$phase) {
            return fn();
          }

          return this.scope.$apply(fn);
        }
      },
      {
        $inject: ['$scope', '$element'],
      }
    ),
  });

  Angular.bootstrap(document.body, ['velcro'], { strictDi: true });
});
