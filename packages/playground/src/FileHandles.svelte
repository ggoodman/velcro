<script lang="typescript">
  import * as Monaco from '@velcro/monaco';
  import { onMount, onDestroy } from 'svelte';
  import FileHandle from './FileHandle.svelte';

  const disposables: Monaco.IDisposable[] = [];

  let models: Monaco.editor.ITextModel[] = Monaco.editor.getModels();

  disposables.push(
    Monaco.editor.onDidCreateModel((model) => {
      models = [...models, model];
      console.log('models', models);
    })
  );

  disposables.push(
    Monaco.editor.onWillDisposeModel((model) => {
      const idx = models.indexOf(model);

      if (idx >= 0) models = [...models.slice(0, idx), ...models.slice(idx + 1)];
      console.log('models', models);
    })
  );
  onDestroy(() => {
    disposables.forEach((disposable) => disposable.dispose());
  });
</script>

<style>
  .handles {
    display: flex;
    flex-direction: row;
  }

  .handles > div {
    flex: 0;
  }
</style>

<div class="handles">
  {#each models as model (model.uri.fsPath)}
    <FileHandle {model} />
  {/each}
</div>
