import { DisposableStore, Emitter, Event } from '@velcro/common';
import type * as Monaco from 'monaco-editor';
import {
  EditorEvent,
  FileCreateEvent,
  FileRemoveEvent,
  FileUpdateEvent,
  WorkerState,
} from './types';

const EDITOR_EVENT_THROTTLE_MS = (1000 / 16) | 0;

export function trackMonaco(monaco: typeof Monaco) {
  const disposer = new DisposableStore();
  const worker = new Worker('./velcroWorker.ts', { type: 'module' });

  const trackModel = (model: Monaco.editor.ITextModel) => {
    model.onWillDispose(() => {
      const message: FileRemoveEvent = {
        event: 'file_remove',
        href: model.uri.toString(true),
      };
      postMessage(message);
      disposerReference.dispose();
    });

    const disposerReference = disposer.add(
      model.onDidChangeContent(() => {
        const message: FileUpdateEvent = {
          event: 'file_update',
          content: model.getValue(),
          href: model.uri.toString(true),
        };
        postMessage(message);
      })
    );

    const message: FileCreateEvent = {
      event: 'file_create',
      content: model.getValue(),
      href: model.uri.toString(true),
    };
    postMessage(message);
  };

  const postMessageEmitter = new Emitter<EditorEvent>();
  const postMessageQueue = Event.debounce<EditorEvent, Map<string, EditorEvent>>(
    postMessageEmitter.event,
    (last, event) => {
      if (!last) {
        last = new Map();
      }

      last.set(event.href, event);

      return last;
    },
    EDITOR_EVENT_THROTTLE_MS
  )((events) => {
    worker.postMessage([...events.values()]);
  });

  disposer.add(postMessageEmitter);
  disposer.add(postMessageQueue);

  const postMessage = (message: EditorEvent) => {
    postMessageEmitter.fire(message);
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
