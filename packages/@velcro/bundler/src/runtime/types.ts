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
export type VelcroModuleLinks = {
  [key: string]: { name: string; spec: string; path: string } | undefined;
};
export type VelcroModuleIdentification = { name: string; version: string; path: string };
export interface VelcroRequire {
  (spec: string): unknown;
  resolve(spec: string): string;
}

export type VelcroStaticRuntime = {
  defs: {
    [key: string]: [VelcroModuleFactory, VelcroImportMap] | undefined;
  };
};
