import * as z from 'zod';

export const FileRemoveEvent = z.object({
  event: z.literal('file_remove'),
  href: z.string(),
});
export type FileRemoveEvent = z.infer<typeof FileRemoveEvent>;

export const FileUpdateEvent = z.object({
  event: z.literal('file_update'),
  content: z.string(),
  href: z.string(),
});
export type FileUpdateEvent = z.infer<typeof FileUpdateEvent>;

export const EditorEvent = z.union([FileRemoveEvent, FileUpdateEvent]);
export type EditorEvent = z.infer<typeof EditorEvent>;

export const BuiltState = z.object({
  state: z.literal('built'),
  href: z.string(),
});
export type BuiltState = z.infer<typeof BuiltState>;

export const BuildingState = z.object({
  state: z.literal('building'),
  completed: z.number(),
  pending: z.number(),
});
export type BuildingState = z.infer<typeof BuildingState>;

export const ErrorState = z.object({
  state: z.literal('error'),
  error: z.object({
    message: z.string(),
  }),
});
export type ErrorState = z.infer<typeof ErrorState>;

export const InitialState = z.object({
  state: z.literal('initial'),
});
export type InitialState = z.infer<typeof InitialState>;

export const WorkerState = z.union([BuildingState, BuiltState, ErrorState, InitialState]);
export type WorkerState = z.infer<typeof WorkerState>;
