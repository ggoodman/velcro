import * as Monaco from 'monaco-editor';
import { useEffect, useState, useContext } from 'react';
import { DisposableStore } from 'ts-primitives';

import { EditorContext } from './context';

export enum EntryKind {
  Directory = 'directory',
  File = 'file',
}

export interface IDirectory {
  type: EntryKind.Directory;
  uri: Monaco.Uri;
}
export interface IFile {
  type: EntryKind.File;
  uri: Monaco.Uri;
  model: Monaco.editor.ITextModel;
}

export type DirectoryEntry = IDirectory | IFile;

export function useDirectory(uri = Monaco.Uri.file('/')) {
  // Make sure the URI always ends with a trailing slash
  const prefix = uri.toString(true).replace(/\/?$/, '/');
  const sortEntries = (models: (DirectoryEntry)[]) => {
    const sorted = [...models];

    sorted.sort((a, b) => (a.uri.fsPath > b.uri.fsPath ? 1 : -1));

    return sorted;
  };

  const initialEntries = Monaco.editor.getModels().reduce(
    (entries, model) => {
      const modelUri = model.uri.toString(true);

      if (modelUri.startsWith(prefix)) {
        const nestedPath = modelUri.slice(prefix.length);
        const nextDirIdx = nestedPath.indexOf('/');

        if (nextDirIdx === 0) {
          throw new Error('Invariant error: WAT?');
        }

        if (nextDirIdx > 0) {
          // This is an intermediate directory
          const uri = Monaco.Uri.parse(`${prefix}${nestedPath.slice(0, nextDirIdx + 1)}`);

          entries.push({
            type: EntryKind.Directory,
            uri,
          });
        } else {
          entries.push({
            type: EntryKind.File,
            uri: model.uri,
            model,
          });
        }
      }

      return entries;
    },
    [] as DirectoryEntry[]
  );
  const [entries, setEntries] = useState<(DirectoryEntry)[]>(sortEntries(initialEntries));

  useEffect(() => {
    const disposable = new DisposableStore();

    disposable.add(
      Monaco.editor.onDidCreateModel((model: Monaco.editor.ITextModel) => {
        const modelUri = model.uri.toString(true);

        if (modelUri.startsWith(prefix)) {
          const nestedPath = modelUri.slice(prefix.length);
          const nextDirIdx = nestedPath.indexOf('/');

          if (nextDirIdx === 0) {
            throw new Error('Invariant error: WAT?');
          }

          if (nextDirIdx > 0) {
            // This is an intermediate directory
            const uri = Monaco.Uri.parse(`${prefix}${nestedPath.slice(0, nextDirIdx)}`);

            // It is possible that we already have this directory
            const entry = entries.find(entry => entry.uri.toString(true) === uri.toString(true));

            if (entry) {
              if (entry.type !== EntryKind.Directory) {
                throw new Error(
                  `Invariant violation: A file in '${prefix}' conflicts with the path of the new file '${modelUri}'`
                );
              }

              return;
            }

            entries.push({ type: EntryKind.Directory, uri });

            return setEntries(sortEntries(entries));
          }

          if (
            !entries.find(
              entry => entry.type === EntryKind.File && entry.uri.toString(true) === model.uri.toString(true)
            )
          ) {
            entries.push({ type: EntryKind.File, uri: model.uri, model });

            setEntries(entries);
          }
        }
      })
    );

    disposable.add(
      Monaco.editor.onWillDisposeModel(model => {
        const idx = entries.findIndex(entry => entry.type === EntryKind.File && entry.model === model);

        if (idx === -1) {
          throw new Error(`Invariant violation: Removing an untracked model: '${model.uri.fsPath}'`);
        }

        entries.splice(idx, 1);

        setEntries(sortEntries(entries));
      })
    );

    return () => disposable.dispose();
  }, [entries, prefix]);

  return entries;
}

export function useModels() {
  const [models, setModels] = useState(Monaco.editor.getModels());

  useEffect(() => {
    const onDidCreateModelDisposable = Monaco.editor.onDidCreateModel(model => {
      models.push(model);

      setModels(models);
    });
    const onWillDisposeModelDisposable = Monaco.editor.onWillDisposeModel(model => {
      const idx = models.indexOf(model);

      if (idx >= 0) {
        models.splice(idx, 1);

        setModels(models);
      }
    });

    return () => {
      onDidCreateModelDisposable.dispose();
      onWillDisposeModelDisposable.dispose();
    };
  });
}

export function useFocusedModelWithEditor(editor: Monaco.editor.IStandaloneCodeEditor | null) {
  const [focusedModel, setFocusedModel] = useState<Monaco.editor.ITextModel | null>(editor ? editor.getModel() : null);

  useEffect(() => {
    if (editor) {
      const onDidBlurEditorTextDisposable = editor.onDidBlurEditorText(() => {
        setFocusedModel(null);
      });
      const onDidFocusEditorTextDisposable = editor.onDidFocusEditorText(() => {
        setFocusedModel(editor.getModel());
      });

      return () => {
        onDidBlurEditorTextDisposable.dispose();
        onDidFocusEditorTextDisposable.dispose();
      };
    }
  }, [editor]);

  const focusModel = (model: Monaco.editor.ITextModel | null) => {
    if (editor) {
      editor.setModel(model);
      editor.focus();
    }
  };

  return [focusedModel, focusModel] as const;
}

export function useFocusedModel() {
  const editor = useContext(EditorContext);

  return useFocusedModelWithEditor(editor);
}
