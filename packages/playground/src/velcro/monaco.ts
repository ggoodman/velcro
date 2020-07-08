import { DisposableStore, Emitter } from '@velcro/common';
import type * as Monaco from 'monaco-editor';
import { FileRemoveEvent, FileUpdateEvent, WorkerState } from './types';

export function trackMonaco(monaco: typeof Monaco) {
  const disposer = new DisposableStore();
  const worker = new Worker('./velcroWorker.ts', { type: 'module' });

  const trackModel = (model: Monaco.editor.ITextModel) => {
    model.onWillDispose(() => {
      const message: FileRemoveEvent = {
        event: 'file_remove',
        href: model.uri.toString(true),
      };
      worker.postMessage(message);
      disposerReference.dispose();
    });

    const disposerReference = disposer.add(
      model.onDidChangeContent(() => {
        const message: FileUpdateEvent = {
          event: 'file_update',
          content: model.getValue(),
          href: model.uri.toString(true),
        };
        worker.postMessage(message);
      })
    );

    const message: FileUpdateEvent = {
      event: 'file_update',
      content: model.getValue(),
      href: model.uri.toString(true),
    };
    worker.postMessage(message);
  };

  // Track existing models
  monaco.editor.getModels().forEach(trackModel);

  // And future models
  disposer.add(monaco.editor.onDidCreateModel(trackModel));
  disposer.add({
    dispose: () => worker.terminate(),
  });

  const emitter = new Emitter<WorkerState>();
  disposer.add(emitter);

  worker.addEventListener('message', (e) => {
    if (WorkerState.is(e.data)) {
      emitter.fire(e.data);
    }
  });

  return {
    dispose: () => disposer.dispose(),
    get onStateChange() {
      return emitter.event;
    },
  };
}
