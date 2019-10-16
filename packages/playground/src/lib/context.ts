import { createContext } from 'react';
import * as Monaco from 'monaco-editor';

export const EditorContext = createContext<Monaco.editor.IStandaloneCodeEditor | null>(null);
