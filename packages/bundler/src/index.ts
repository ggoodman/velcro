import * as Velcro from './bundler_interface';
export * from './bundler_interface';

import { createRuntime } from './runtime';

const Runtime = createRuntime((globalThis as any)['Velcro'] || ((globalThis as any)['Velcro'] = { ...Velcro }));

export const runtime = new Runtime();
