export const id = 'svelte';

export const name = 'Svelte Template';

export const defaultFile = 'App.svelte';

export const files: Record<string, string> = {
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
  [defaultFile]:
    `
<script>
  export let answer;
</script>

<style>
main {
  font-family: Open Sans, Helvetica Neue, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #333;
}
</style>

<main class="app">
  <h1>What is {answer}?</h1>
  <p>It is the answer, of course... To life, the universe and everything!</p>
</main>
    `.trim() + '\n',
  'index.js':
    `
import App from './App.svelte';

const app = new App({
	target: document.body,
	props: {
		// we'll learn about props later
		answer: 42
	}
});
        `.trim() + '\n',
};
