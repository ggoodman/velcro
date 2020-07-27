import * as AgGrid from './ag-Grid';
import * as React from './react';
import * as Svelte from './svelte';

export interface ITemplate {
  id: string;
  defaultFile: string;
  files: Record<string, string>;
  name: string;
}

export const templates: ITemplate[] = [AgGrid, React, Svelte];
