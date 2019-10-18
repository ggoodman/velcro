type ModuleFactory = (
  this: any,
  module: { exports: any },
  exports: any,
  require: RequireFunction,
  __dirname: string,
  __pathname: string
) => void;

type RequireFunction = (spec: string) => any;

export interface IRuntime {
  alias(spec: string, href: string): void;
  import(sect: string): Promise<any>;
  register(spec: string, factory: ModuleFactory): any;
  remove(spec: string): boolean;
  require(spec: string): any;
}

export function createRuntime(Velcro: typeof import('.')): { new (): IRuntime };
