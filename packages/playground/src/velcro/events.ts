import { DefineEvent } from './fsm';

export type SourceMapOption = 'data-uri' | 'none' | 'string';

export declare namespace Events {
  export type FileCreate = DefineEvent<'file_create', { href: string; content: string }>;
  export type FileRemove = DefineEvent<'file_remove', { href: string }>;
  export type FileUpdate = DefineEvent<'file_update', { href: string; content: string }>;
  export type TimerFired = DefineEvent<'timer_fired'>;
  export type StartBuild = DefineEvent<
    'start_build',
    { entrypoints: string[]; generateSourceMap: SourceMapOption }
  >;
  export type BuildProgress = DefineEvent<
    'build_progress',
    { pending: number; completed: number; start: number }
  >;
  export type BuildComplete = DefineEvent<
    'build_complete',
    { code: string; sourceMap: string; start: number; end: number }
  >;
  export type BuildError = DefineEvent<
    'build_error',
    { error: string; start: number; end: number }
  >;
}

export type Events =
  | Events.FileCreate
  | Events.FileRemove
  | Events.FileUpdate
  | Events.TimerFired
  | Events.StartBuild
  | Events.BuildProgress
  | Events.BuildComplete
  | Events.BuildError;
