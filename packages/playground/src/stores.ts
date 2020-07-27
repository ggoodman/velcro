import type * as Monaco from '@velcro/monaco';
import { writable } from 'svelte/store';
import type { IProject } from './lib/project';

export const currentModel = writable<Monaco.editor.ITextModel | undefined>(undefined);
export const currentProject = writable<IProject>({
  id: 'empty',
  name: 'Empty project',
  files: {},
  initialPath: '',
});
