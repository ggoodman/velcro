export const files = {
  'package.json':
    JSON.stringify(
      {
        name: 'test',
        version: '0.0.0',
        dependencies: {
          svelte: '^3.24.0',
        },
      },
      null,
      2
    ) + '\n',
  'index.jsx':
    `
import App from './App.svelte';

new App({
  target: document.body,
  props: {
    name: 'World',
  }
});
    `.trim() + '\n',
  'App.svelte':
    `
<script>
  import Button from './Button.svelte';

  export let name;
</script>

<h1>Hello {name}</h1>
<Button>Click me, I do nothing</Button>
    `.trim() + '\n',
  'Button.svelte':
    `
<button on:click|once={() => alert('well, almost nothing')}>
  <slot />
</button>
    `.trim() + '\n',
};
