import { DisposableStore, IDisposable } from '@velcro/common';
import * as Monaco from 'monaco-editor';
import { VelcroBuilder } from './builder';

export function wireMonaco(monaco: typeof Monaco, client: VelcroBuilder): IDisposable {
  const disposer = new DisposableStore();

  const trackModel = (model: Monaco.editor.ITextModel) => {
    disposer.add(
      model.onWillDispose(() => {
        client.sendEvent('file_remove', { href: model.uri.toString() });
      })
    );

    disposer.add(
      model.onDidChangeContent(() => {
        client.sendEvent('file_update', { content: model.getValue(), href: model.uri.toString() });
      })
    );

    client.sendEvent('file_create', { content: model.getValue(), href: model.uri.toString() });
  };

  // Track existing models
  monaco.editor.getModels().forEach(trackModel);

  // And future models
  disposer.add(monaco.editor.onDidCreateModel(trackModel));

  return disposer;
}
