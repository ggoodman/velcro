import type { VelcroRuntime } from './runtimeInterface';

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

type VelcroModuleGeneration = number;

export type VelcroStaticRuntime = {
  defs: {
    [key: string]: [VelcroModuleFactory, VelcroImportMap, VelcroModuleGeneration] | undefined;
  };
  runtime?: VelcroRuntime;
};
