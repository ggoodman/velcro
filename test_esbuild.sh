#!/usr/bin/env bash

set -euxo pipefail

# Run existing rollup build
npx lerna run build --scope nostalgie

# Run esbuild
npx esbuild --bundle ./packages/nostalgie/src/index.ts --outfile=./packages/nostalgie/dist/index.esbuild.js --format=iife --minify --sourcemap --define:process.env.NODE_ENV='"production"'

# Compare sizes

echo "Size with Rollup Pipeline"
du -h ./packages/nostalgie/dist/index.umd.js
echo "Size with esbuild"
du -h ./packages/nostalgie/dist/index.esbuild.js
