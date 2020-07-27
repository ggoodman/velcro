//@ts-check
const Chokidar = require('chokidar');
const ChildProcess = require('child_process');
const { startService } = require('esbuild');
const Events = require('events');
const Path = require('path');

const builds = [
  '@velcro/bundler',
  '@velcro/common',
  '@velcro/plugin-css',
  '@velcro/plugin-sucrase',
  '@velcro/resolver',
  '@velcro/runner',
  '@velcro/strategy-cdn',
  '@velcro/strategy-compound',
  '@velcro/strategy-fs',
  '@velcro/strategy-memory',
];

const externals = [...builds, '@velcro/node-libs'];

function toUmdName(name) {
  let umdName = 'Velcro = Velcro || {}; Velcro.';

  for (const segment of name.replace('@velcro/', '').split(/[^a-z]/)) {
    umdName += segment.charAt(0).toUpperCase() + segment.slice(1);
  }

  return umdName;
}

/** @type {import('esbuild').BuildOptions[]} */
const configs = [];

for (const path of builds) {
  configs.push(
    {
      bundle: true,
      define: {
        'process.env.NODE_ENV': '"development"',
      },
      entryPoints: [Path.resolve(process.cwd(), `./packages/${path}/src/index.ts`)],
      external: externals,
      outfile: Path.resolve(process.cwd(), `./packages/${path}/dist/index.cjs.js`),
      format: 'cjs',
      platform: 'browser',
      sourcemap: true,
      tsconfig: Path.resolve(process.cwd(), './packages/${path}/tsconfig.json'),
    },
    {
      bundle: true,
      define: {
        'process.env.NODE_ENV': '"development"',
      },
      entryPoints: [Path.resolve(process.cwd(), `./packages/${path}/src/index.ts`)],
      external: externals,
      outfile: Path.resolve(process.cwd(), `./packages/${path}/dist/index.esm.js`),
      format: 'esm',
      platform: 'browser',
      sourcemap: true,
      tsconfig: Path.resolve(process.cwd(), `./packages/${path}/tsconfig.json`),
    },
    {
      bundle: true,
      define: {
        'process.env.NODE_ENV': '"development"',
      },
      entryPoints: [Path.resolve(process.cwd(), `./packages/${path}/src/index.ts`)],
      external: externals,
      minify: false,
      outfile: Path.resolve(process.cwd(), `./packages/${path}/dist/index.umd.js`),
      globalName: toUmdName(path),
      format: 'iife',
      platform: 'browser',
      sourcemap: true,
      tsconfig: Path.resolve(process.cwd(), `./packages/${path}/tsconfig.json`),
    }
  );
}

async function main() {
  // Start the esbuild child process once
  const service = await startService();
  const tsc = ChildProcess.spawn(
    'npx',
    ['tsc', '--build', '--watch', '--preserveWatchOutput', '.'],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: process.cwd(),
    }
  );
  const watcher = Chokidar.watch('./packages/**/src/**/*.ts', {
    ignored: /node_modules/,
    persistent: true,
    followSymlinks: false,
    cwd: __dirname,
  });

  /** @type {Promise<unknown> | undefined} */
  let pending = undefined;

  await Events.once(watcher, 'ready');

  console.log('Watcher ready');

  process.on('SIGINT', () => {
    console.log('Received SIGINT, stopping...');
    watcher.close();
    tsc.kill('SIGKILL');
  });

  const buildOnce = async () => {
    if (pending) {
      console.log('Waiting for pending build');
      await pending;
    }

    console.log('Building');

    pending = Promise.all(configs.map((config) => service.build(config))).then(
      (buildResult) => {
        console.log('Build complete');
        pending = undefined;
      },
      (err) => {
        console.error(err);
        pending = undefined;
      }
    );
  };

  watcher.on('all', buildOnce);

  buildOnce();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
