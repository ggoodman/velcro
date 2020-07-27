<script context="module" lang="typescript">
  import * as Monaco from '@velcro/monaco';
  import { currentModel } from './stores';

  const MonacoEnvironment: Monaco.Environment = {
    getWorker(workerId: string, label: string) {
      console.log('getWorker(%s, %s)', workerId, label);

      switch (label) {
        case 'css':
          return new Worker(
            'https://cdn.jsdelivr.net/npm/monaco-editor@0.20.0/min/vs/language/css/cssWorker.js'
          );
        case 'html':
          return new Worker(
            'https://cdn.jsdelivr.net/npm/monaco-editor@0.20.0/min/vs/language/html/htmlWorker.js'
          );
        case 'json':
          return new Worker(
            'https://cdn.jsdelivr.net/npm/monaco-editor@0.20.0/min/vs/language/json/jsonWorker.js'
          );
        case 'javascript':
        case 'typescript':
          return new Worker(
            'https://cdn.jsdelivr.net/npm/monaco-editor@0.20.0/min/vs/language/typescript/tsWorker.js'
          );
        case 'editorWorkerService':
          return new Worker(
            'https://cdn.jsdelivr.net/npm/monaco-editor@0.20.0/min/vs/base/worker/workerMain.js'
          );
      }

      throw new Error(`No worker found for workerId: ${workerId}, label: ${label}`);
    },
  };

  //@ts-ignore
  globalThis.MonacoEnvironment = MonacoEnvironment;

  Monaco.editor.onDidCreateEditor((editor) => {
    editor.onDidFocusEditorText(() => {
      currentModel.set(editor.getModel()!);
    });

    editor.onDidBlurEditorText(() => {
      currentModel.set(undefined);
    });
  });
</script>

<script lang="typescript">
  import { onMount, onDestroy } from 'svelte';

  let editorDiv: HTMLDivElement | undefined;

  let editor: Monaco.editor.IStandaloneCodeEditor | undefined = undefined;

  const subscription = currentModel.subscribe((model) => {
    if (editor && model && model !== editor.getModel()) {
      editor.setModel(model);
      editor.focus();
    }
  });

  onMount(() => {
    editor = Monaco.editor.create(editorDiv!, {
      model: null,
    });

    editor.focus();
  });

  onDestroy(() => {
    if (editor) {
      editor.dispose();
    }

    subscription();
  });
</script>

<style>
  .editor {
    width: 400px;
    height: 300px;
  }
</style>

<div class="editor" bind:this={editorDiv} />
