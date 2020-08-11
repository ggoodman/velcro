import { SourceMapOption } from './events';
import { DefineState } from './fsm';

export declare namespace States {
  export type Idle = DefineState<'idle'>;
  export type DirtyReset = DefineState<'dirty_reset'>;
  export type Dirty = DefineState<'dirty'>;
  export type BuildInProgress = DefineState<
    'build_in_progress',
    { generateSourceMap: SourceMapOption; pending: number; completed: number; start: number }
  >;
  export type BuildComplete = DefineState<
    'build_complete',
    { code: string; sourceMap: string; start: number; end: number }
  >;
  export type BuildError = DefineState<
    'build_error',
    { error: string; start: number; end: number }
  >;
}

export type States =
  | States.Idle
  | States.DirtyReset
  | States.Dirty
  | States.BuildInProgress
  | States.BuildComplete
  | States.BuildError;
