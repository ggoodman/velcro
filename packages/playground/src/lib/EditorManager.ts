import { DisposableStore, Emitter, Event, IDisposable } from '@velcro/common';
import { execute } from '@velcro/runner';
import * as Monaco from 'monaco-editor';
import { createContext, useContext, useEffect, useState } from 'react';
import * as SvelteLanguage from './svelte.language';

const readUrl = (href: string) => fetch(href).then((res) => res.arrayBuffer());

export class EditorManager implements IDisposable {
  editor: Monaco.editor.IStandaloneCodeEditor | null = null;

  private readonly disposableStore = new DisposableStore();
  private readonly initialPath: string | undefined;
  private readonly viewState = new WeakMap<
    Monaco.editor.ITextModel,
    Monaco.editor.ICodeEditorViewState
  >();

  private readonly onWillFocusModelEmitter = new Emitter<Monaco.editor.ITextModel>();
  private readonly onDidChangeEmitter = new Emitter<{ model: Monaco.editor.ITextModel }>();

  constructor(options: { files?: Record<string, string>; initialPath?: string } = {}) {
    this.disposableStore.add(this.onWillFocusModelEmitter);
    this.disposableStore.add(this.onDidChangeEmitter);

    Monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    Monaco.languages.typescript.typescriptDefaults.setMaximumWorkerIdleTime(-1);
    Monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      allowJs: true,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      baseUrl: '.',
      checkJs: true,
      esModuleInterop: true,
      experimentalDecorators: true,
      inlineSourceMap: true,
      inlineSources: true,
      isolatedModules: false,
      jsx: Monaco.languages.typescript.JsxEmit.React,
      lib: ['dom'],
      module: Monaco.languages.typescript.ModuleKind.CommonJS,
      moduleResolution: Monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      noEmit: false,
      outDir: `dist`,
      resolveJsonModule: true,
      rootDir: '/',
      sourceMap: true,
      target: Monaco.languages.typescript.ScriptTarget.ES2015,
      typeRoots: ['node_modules/@types'],
    });
    Monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });

    Monaco.languages.register({
      id: 'svelte',
      extensions: ['.svelte'],
      mimetypes: ['text/x-svelte'],
    });
    Monaco.languages.setLanguageConfiguration(
      'svelte',
      SvelteLanguage.conf as Monaco.languages.LanguageConfiguration
    );
    Monaco.languages.setMonarchTokensProvider(
      'svelte',
      SvelteLanguage.language as Monaco.languages.IMonarchLanguage
    );

    const createPrettierFormattingProvider = (): Monaco.languages.DocumentFormattingEditProvider => {
      let prettierPromise:
        | Promise<{
            prettier: typeof import('prettier/standalone');
            plugins: import('prettier').Plugin[];
          }>
        | undefined = undefined;

      const loadPrettier = async () => {
        if (!prettierPromise) {
          prettierPromise = execute(
            'module.exports = { prettier: require("prettier/standalone"), plugins: [require("prettier/parser-babel"), require("prettier/parser-html"), require("prettier/parser-postcss")] };',
            {
              readUrl,
              cdn: 'jsdelivr',
              dependencies: {
                prettier: '^2.0.5',
              },
              nodeEnv: 'production',
              packageMain: ['browser', 'main'],
              sourceMap: false,
            }
          );

          prettierPromise.catch((e) => {
            console.error(e);
            debugger;
          });
        }

        return prettierPromise;
      };

      return {
        async provideDocumentFormattingEdits(model, options, token) {
          const { prettier, plugins } = await loadPrettier();

          if (token.isCancellationRequested) {
            return [];
          }

          const formatted = prettier.format(model.getValue(), {
            filepath: model.uri.fsPath,
            singleQuote: true,
            tabWidth: 2,
            plugins,
          });

          return [
            {
              range: model.getFullModelRange(),
              text: formatted,
            },
          ];
        },
      };
    };

    const codeFormattingEditProvider = createPrettierFormattingProvider();

    Monaco.languages.registerDocumentFormattingEditProvider('css', codeFormattingEditProvider);

    Monaco.languages.registerDocumentFormattingEditProvider('html', codeFormattingEditProvider);

    Monaco.languages.registerDocumentFormattingEditProvider(
      'javascript',
      codeFormattingEditProvider
    );

    Monaco.languages.registerDocumentFormattingEditProvider(
      'typescript',
      codeFormattingEditProvider
    );

    if (options.files) {
      for (const pathname in options.files) {
        const content = options.files[pathname];

        this.createModel(pathname, content);
      }
    }

    this.initialPath = options.initialPath;
  }

  get dispose() {
    return this.disposableStore.dispose;
  }

  get onDidChange(): Event<{ model: Monaco.editor.ITextModel }> {
    return this.onDidChangeEmitter.event;
  }

  get onWillFocusModel(): Event<Monaco.editor.ITextModel> {
    return this.onWillFocusModelEmitter.event;
  }

  createModel(pathname: string, content = '') {
    const language = this.inferLanguage(pathname);

    let uri: Monaco.Uri;

    try {
      uri = Monaco.Uri.file(pathname);
    } catch (err) {
      throw new Error(`Invalid path '${pathname}': ${err && err.message}`);
    }

    if (Monaco.editor.getModel(uri)) {
      throw new Error(`Cannot create file because it exists '${pathname}'`);
    }

    return Monaco.editor.createModel(content, language, uri);
  }

  focusHref(
    href: string,
    options: {
      lineNumber?: number;
      columnNumber?: number;
      markers?: Monaco.editor.IMarkerData[];
    } = {}
  ) {
    const model = this.getModelByHref(href);

    if (model) {
      this.focusModel(model, options);
    }
  }

  focusModel(
    model: Monaco.editor.ITextModel,
    options: {
      lineNumber?: number;
      columnNumber?: number;
      markers?: Monaco.editor.IMarkerData[];
    } = {}
  ) {
    if (this.editor) {
      this.editor.setModel(model);
      if (options.lineNumber) {
        this.editor.revealLineInCenter(options.lineNumber, Monaco.editor.ScrollType.Smooth);
        this.editor.setPosition({
          column: options.columnNumber || 0,
          lineNumber: options.lineNumber,
        });
      }
      if (options.markers) {
        Monaco.editor.setModelMarkers(model, 'editorManager', options.markers);
      }
      this.editor.focus();
    }
  }

  focusPath(
    path: string,
    options: {
      lineNumber?: number;
      columnNumber?: number;
      markers?: Monaco.editor.IMarkerData[];
    } = {}
  ) {
    const model = this.getModelByPath(path);

    if (model) {
      this.focusModel(model, options);
    }
  }

  getModelByHref(href: string) {
    try {
      const uri = Monaco.Uri.parse(href);
      return Monaco.editor.getModel(uri);
    } catch (_) {
      return null;
    }
  }

  getModelByPath(path: string) {
    return Monaco.editor.getModel(Monaco.Uri.file(path));
  }

  mount(el: HTMLElement) {
    if (this.editor) {
      throw new Error('Invariant violation: Editor already mounted');
    }

    this.editor = Monaco.editor.create(el, {
      model: null,
      automaticLayout: true,
      minimap: {
        enabled: false,
      },
      showUnused: true,
      scrollBeyondLastLine: false,
      theme: 'vs',
      wordWrap: 'bounded',
      wrappingIndent: 'same',
    });

    this.editor.onDidDispose(() => {
      this.editor = null;
    });

    this.editor.onDidChangeModel((e) => {
      if (e.newModelUrl && this.editor) {
        const model = Monaco.editor.getModel(e.newModelUrl)!;
        const viewState = this.viewState.get(model);

        if (viewState) {
          this.editor.restoreViewState(viewState);
        }
      }
    });

    this.editor.onDidBlurEditorText(() => {
      if (this.editor) {
        const model = this.editor.getModel();
        const viewState = this.editor.saveViewState();

        if (model && viewState) {
          this.viewState.set(model, viewState);
        }
      }
    });

    this.disposableStore.add(this.editor);

    if (this.initialPath) {
      this.focusPath(this.initialPath);
    }

    return this.editor;
  }

  inferLanguage(pathname: string) {
    return pathname.match(/\.(?:tsx?|jsx?)$/) ? 'typescript' : undefined;
  }
}

export const EditorManagerContext = createContext<EditorManager>(undefined as any);

export function useActiveModel() {
  const workbench = useContext(EditorManagerContext);
  const [activeModel, setActiveModel] = useState<Monaco.editor.ITextModel | null>(
    workbench.editor ? workbench.editor.getModel() : null
  );

  useEffect(() => {
    const disposable = new DisposableStore();

    const trackEditor = (editor: Monaco.editor.ICodeEditor) => {
      editor.onDidChangeModel((e) => {
        const model = e.newModelUrl ? Monaco.editor.getModel(e.newModelUrl) : null;

        setActiveModel(model);
      });

      disposable.add(
        editor.onDidBlurEditorText(() => {
          setActiveModel(null);
        })
      );

      disposable.add(
        editor.onDidFocusEditorText(() => {
          setActiveModel(editor.getModel());
        })
      );

      if (editor.hasTextFocus()) {
        setActiveModel(editor.getModel());
      }
    };

    disposable.add(Monaco.editor.onDidCreateEditor(trackEditor));
    if (workbench.editor) {
      trackEditor(workbench.editor);
    }

    return () => disposable.dispose();
  }, [workbench.editor, activeModel]);

  return activeModel;
}
