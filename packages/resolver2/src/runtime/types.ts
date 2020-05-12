export const velcroModuleFactory = Object.assign(
  function (
    module: VelcroModule,
    exports: VelcroModule['exports'],
    require: VelcroRequire,
    __dirname: string,
    __filename: string
  ): void {
    [module, exports, require, __dirname, __filename];
  },
  {
    splitString: '[module, exports, require, __dirname, __filename];',
  }
);

export const velcroChunkWrapper = Object.assign(
  function (velcro: VelcroStaticRuntime) {
    '----';
    return velcro;
  },
  {
    splitString: `'----';`,
  }
);

export type VelcroImportMap = {
  imports?: { [key: string]: string };
  scopes?: { [fromId: string]: { [key: string]: string | undefined } | undefined };
};
export type VelcroModule = { exports: Record<string | number | symbol, unknown> };
export type VelcroModuleFactory = typeof velcroModuleFactory;
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
