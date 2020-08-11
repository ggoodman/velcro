import * as t from 'io-ts';

export namespace Client {
  export const StartBuildEvent = t.type({
    event: t.literal('start_build'),
    entrypoints: t.array(t.string),
    generateSourceMap: t.union([t.literal('data-uri'), t.literal('none'), t.literal('string')]),
  });
  export type StartBuildEvent = t.TypeOf<typeof StartBuildEvent>;

  export const FileCreateEvent = t.type({
    event: t.literal('file_create'),
    content: t.string,
    href: t.string,
  });
  export type FileCreateEvent = t.TypeOf<typeof FileCreateEvent>;

  export const FileRemoveEvent = t.type({
    event: t.literal('file_remove'),
    href: t.string,
  });
  export type FileRemoveEvent = t.TypeOf<typeof FileRemoveEvent>;

  export const FileUpdateEvent = t.type({
    event: t.literal('file_update'),
    content: t.string,
    href: t.string,
  });
  export type FileUpdateEvent = t.TypeOf<typeof FileUpdateEvent>;

  export const FileEvent = t.union([FileCreateEvent, FileRemoveEvent, FileUpdateEvent]);
  export type FileEvent = t.TypeOf<typeof FileEvent>;

  export const Any = t.union([FileCreateEvent, FileRemoveEvent, FileUpdateEvent, StartBuildEvent]);
  export type Any = t.TypeOf<typeof Any>;

  // export const EditorEvents = t.array(EditorEvent);
  // export type EditorEvents = t.TypeOf<typeof EditorEvents>;
}

export namespace Server {
  export const BuildProgress = t.type({
    eventName: t.literal('build_progress'),
    data: t.type({
      pending: t.number,
      completed: t.number,
      start: t.number,
    }),
  });
  export type BuildProgress = t.TypeOf<typeof BuildProgress>;

  export const BuildComplete = t.type({
    eventName: t.literal('build_complete'),
    data: t.type({
      code: t.string,
      sourceMap: t.string,
      start: t.number,
      end: t.number,
    }),
  });
  export type BuildComplete = t.TypeOf<typeof BuildComplete>;

  export const BuildError = t.type({
    eventName: t.literal('build_error'),
    data: t.type({
      error: t.string,
      start: t.number,
      end: t.number,
    }),
  });
  export type BuildError = t.TypeOf<typeof BuildError>;

  export const AnyEvent = t.union([BuildProgress, BuildComplete, BuildError]);
  export type AnyEvent = t.TypeOf<typeof AnyEvent>;
}
