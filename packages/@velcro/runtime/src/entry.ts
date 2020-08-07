// This file is the entry-point for generating the runtime.
// It will be bundled and then embedded in `./code.ts` as an
// exported string property `runtime`.

import { Runtime } from './runtime';
import type { VelcroEnvironment } from './types';

declare const Velcro: VelcroEnvironment;

Velcro.runtime = Runtime.create(Velcro);
