import type { Module } from './module';
import type { Runtime } from './runtime';

export type VelcroEnvironment = {
  registry: {
    defs: ModuleDefinitions;
  };
  Runtime: typeof Runtime;
  Module: typeof Module;
  runtime: Runtime;
};

export type VelcroImportMap = {
  imports?: { [key: string]: string };
  scopes?: { [fromId: string]: { [key: string]: string | undefined } | undefined };
};

export type VelcroModule = { exports: Record<string | number | symbol, unknown> };

export type VelcroModuleFactory = (
  module: VelcroModule,
  exports: VelcroModule['exports'],
  require: VelcroRequire,
  __dirname: string,
  __filename: string
) => void;

export interface VelcroRequire {
  (spec: string): unknown;
  resolve(spec: string): string;
}

export type VelcroModuleGeneration = number;

export type ModuleDefinitions = {
  [key: string]: [VelcroModuleFactory, VelcroImportMap, VelcroModuleGeneration] | undefined;
};
