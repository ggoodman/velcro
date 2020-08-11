import { DisposableStore } from '@velcro/common';
import * as Monaco from 'monaco-editor';
import { VelcroBuilderClient, VelcroBuilderClientOptions } from './client';
import { wireMonaco } from './wireMonaco';

export function trackMonaco(monaco: typeof Monaco, options: VelcroBuilderClientOptions = {}) {
  const disposer = new DisposableStore();
  const client = new VelcroBuilderClient(options);
  const wiredMonaco = wireMonaco(monaco, client);

  disposer.add(client);
  disposer.add(wiredMonaco);

  return {
    dispose() {
      return disposer.dispose();
    },
    get onStateChange() {
      return client.onStateChange;
    },
  };
}
