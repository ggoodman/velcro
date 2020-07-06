import { DisposableStore } from '@velcro/common';
import * as Monaco from 'monaco-editor';
import { useEffect, useState } from 'react';

// import { EditorContext } from './context';

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

export function useDirectory(uri: Monaco.Uri) {
  // Make sure the URI always ends with a trailing slash
  const prefix = uri.toString(true).replace(/\/?$/, '/');
  const sortEntries = (models: DirectoryEntry[]) => {
    return [...models].sort((a, b) => (a.uri.fsPath > b.uri.fsPath ? 1 : -1));
  };

  const initialEntries = sortEntries(
    Monaco.editor.getModels().reduce((entries, model) => {
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
    }, [] as DirectoryEntry[])
  );
  const [entries, setEntries] = useState(initialEntries);

  useEffect(() => {
    const disposable = new DisposableStore();
    const prefix = uri.toString(true).replace(/\/?$/, '/');

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
            const entry = entries.find((entry) => entry.uri.toString(true) === uri.toString(true));

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
              (entry) =>
                entry.type === EntryKind.File &&
                entry.uri.toString(true) === model.uri.toString(true)
            )
          ) {
            entries.push({ type: EntryKind.File, uri: model.uri, model });

            setEntries(sortEntries(entries));
          }
        }
      })
    );

    disposable.add(
      Monaco.editor.onWillDisposeModel((model) => {
        const idx = entries.findIndex(
          (entry) => entry.type === EntryKind.File && entry.model === model
        );

        if (idx === -1) {
          throw new Error(
            `Invariant violation: Removing an untracked model: '${model.uri.fsPath}'`
          );
        }

        entries.splice(idx, 1);

        setEntries(sortEntries(entries));
      })
    );

    return () => disposable.dispose();
  }, [entries, uri]);

  return entries;
}
