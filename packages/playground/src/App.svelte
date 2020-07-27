<script lang="typescript">
  import Editor from './Editor.svelte';
  import Toolbar from './Toolbar.svelte';
  import CodePane from './CodePane.svelte';
  import PreviewPane from './PreviewPane.svelte';
  import * as Monaco from '@velcro/monaco';
  // import * as template from './lib/templates/svelte';
  import { onDestroy } from 'svelte';

  // const disposables: Monaco.IDisposable[] = [];

  // for (const pathname in template.files) {
  //   disposables.push(
  //     Monaco.editor.createModel(template.files[pathname], undefined, Monaco.Uri.file(pathname))
  //   );
  // }

  // onDestroy(() => {
  //   disposables.forEach((disposable) => disposable.dispose());
  // });
</script>

<style>
  .repl {
    display: grid;
    grid-template: 40px minmax(200px, auto) / 1fr 1fr;
  }

  .repl :component(Toolbar) {
    grid-area: 1 / 1 / 2/ 3;
  }

  .repl :global(.codepane) {
    grid-area: 2 / 1 / 3/ 2;
  }

  .repl :global(.previewpane) {
    grid-area: 2 / 2 / 3/ 3;
  }
</style>

<div class="repl">
  <div class="toolbar">
    <Toolbar />
  </div>
  <div class="codepane">
    <CodePane />
  </div>
  <div class="previewpane">
    <PreviewPane />
  </div>
</div>
