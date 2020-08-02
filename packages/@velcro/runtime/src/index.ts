import { Runtime } from './runtime';
import { VelcroEnvironment } from './types';

export * from './types';
export declare const runtime: string;
export declare const Velcro: VelcroEnvironment;

Velcro.runtime = Runtime.create(Velcro);
