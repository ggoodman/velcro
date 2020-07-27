<script lang="typescript">
  import type * as Monaco from '@velcro/monaco';
  import { currentModel } from './stores';

  export let model: Monaco.editor.ITextModel;

  $: active = model === $currentModel;

  function onClick() {
    currentModel.set(model);
  }
</script>

<style>
  .handle.active {
    color: blue;
  }

  .handle {
    padding: 4px 8px;
    border: 1px solid #ccc;
  }

  .handle:not(:last-child) {
    border-right: none;
  }
</style>

<div class="handle" class:active on:click={onClick}>{model.uri.fsPath.slice(1)}</div>
