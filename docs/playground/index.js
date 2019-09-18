//@ts-check

/** @type {import('angular')} */
const Angular = window['angular'];

/** @type {import('../../packages/bundler') & import('../../packages/resolver') & import('../../packages/resolver-host-compound') & import('../../packages/resolver-host-memory') & import('../../packages/resolver-host-unpkg')} */
const Velcro = window['Velcro'];

/** @type {import('monaco-editor/dev/vs/loader')} */
const Loader = window['require'];

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
          /**
           * @private
           * @readonly
           * @type {Record<string, import('monaco-editor').editor.ITextModel>}
           **/
          this.models = {};

          const indexUri = Monaco.Uri.file('/index.js');
          this.models[indexUri.fsPath] = Monaco.editor.createModel(
            `
import React, { Component } from 'react';
import ReactDOM from 'react-dom';

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

          const packageJsonUri = Monaco.Uri.file('/package.json');
          this.models[packageJsonUri.fsPath] = Monaco.editor.createModel(
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

          const ctrl = this;

          const unpkgHost = new Velcro.ResolverHostUnpkg();

          /** @type {import('../../packages/resolver').Resolver.Host} */
          const memoryHostWrapper = new (class extends Velcro.Resolver.Host {
            async getResolveRoot() {
              return new URL('file:///');
            }
            async listEntries() {
              return Object.keys(ctrl.models).map(path => {
                return {
                  type: Velcro.ResolvedEntryKind.File,
                  url: new URL(`file://${path}`),
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
              const model = ctrl.models[uri.fsPath];

              if (model.getModeId() === 'typescript') {
                const workerFactory = await Monaco.languages.typescript.getTypeScriptWorker();
                const workerClient = await workerFactory(uri);
                const uriStr = uri.toString(true);
                const emitOutput = await workerClient.getEmitOutput(uriStr);

                if (emitOutput.emitSkipped) {
                  throw new Error(`Emit skipped when trying to load ${url}`);
                }

                return encoder.encode(emitOutput.outputFiles[0].text);
              }

              return encoder.encode(model.getValue());
            }
          })();

          const memoryRoot = Monaco.Uri.file('/').toString(true);
          const resolverHost = new Velcro.ResolverHostCompound({
            ['https://unpkg.com/']: unpkgHost,
            [memoryRoot]: memoryHostWrapper,
          });
          const resolver = new Velcro.Resolver(resolverHost, {
            packageMain: ['browser', 'main'],
          });

          this.bundler = new Velcro.Bundler({ resolver });
        }

        $postLink() {
          const editorDiv = this.el.children().children()[1];
          const model = this.models[Monaco.Uri.file('/index.js').fsPath];

          this.editor = Monaco.editor.create(editorDiv, {
            model: null,
          });

          this.editor.onDidChangeModel(e => {
            this.withApply(() => {
              this.activeModelPath = e.newModelUrl.fsPath;
            });
          });

          this.editor.onDidBlurEditorText(() => {
            this.withApply(() => {
              this.focusedModelPath = undefined;
            });
          });

          this.editor.onDidFocusEditorText(() => {
            this.withApply(() => {
              this.focusedModelPath = this.editor.getModel().uri.fsPath;
            });
          });

          this.editor.setModel(model);
          this.editor.focus();

          for (const path in this.models) {
            const model = this.models[path];

            model.onDidChangeContent(e => {
              if (this.debounceTimeout) {
                clearTimeout(this.debounceTimeout);
              }

              this.debounceTimeout = setTimeout(() => this.refreshPreview(), 1000);
            });
          }

          this.refreshPreview();
        }

        /**
         *
         * @param {string} path
         */
        onClickPath(path) {
          const model = this.models[path];

          if (model) {
            this.editor.setModel(model);
            this.editor.focus();
          }
        }

        async refreshPreview() {
          console.time('refreshPreview');
          if (this.previousIframe) {
            this.previousIframe.remove();
            this.previousIframe = undefined;
          }

          if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = undefined;
          }

          const preview = this.el.children().children()[2];
          const iframe = document.createElement('iframe');
          iframe.className = 'iframe';

          this.loadingIndicator = document.createElement('pre');
          this.loadingIndicator.className = 'status';
          this.loadingIndicator.textContent = 'Loading...';

          preview.appendChild(this.loadingIndicator);

          try {
            this.previousIframe = iframe;

            const entrypoint = Monaco.Uri.file('/index.js').toString(true);

            this.bundler.remove(entrypoint);

            await this.bundler.add(entrypoint);

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

            this.loadingIndicator.remove();
            this.loadingIndicator = undefined;

            preview.appendChild(iframe);
          } catch (err) {
            this.loadingIndicator.textContent = `Loading failed: ${err.stack}`;
          }

          console.timeEnd('refreshPreview');
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
