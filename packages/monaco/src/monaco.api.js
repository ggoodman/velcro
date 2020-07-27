import { EditorOptions } from 'monaco-editor/esm/vs/editor/common/config/editorOptions';
import { createMonacoBaseAPI } from 'monaco-editor/esm/vs/editor/common/standalone/standaloneBase.js';
import { createMonacoEditorAPI } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneEditor.js';
import { createMonacoLanguagesAPI } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneLanguages.js';
// Set defaults for standalone editor
EditorOptions.wrappingIndent.defaultValue = 0 /* None */;
EditorOptions.glyphMargin.defaultValue = false;
EditorOptions.autoIndent.defaultValue = 3 /* Advanced */;
EditorOptions.overviewRulerLanes.defaultValue = 2;
self.monaco = createMonacoBaseAPI();
monaco.editor = createMonacoEditorAPI();
monaco.languages = createMonacoLanguagesAPI();

export const CancellationTokenSource = monaco.CancellationTokenSource;
export const Emitter = monaco.Emitter;
export const KeyCode = monaco.KeyCode;
export const KeyMod = monaco.KeyMod;
export const Position = monaco.Position;
export const Range = monaco.Range;
export const Selection = monaco.Selection;
export const SelectionDirection = monaco.SelectionDirection;
export const MarkerSeverity = monaco.MarkerSeverity;
export const MarkerTag = monaco.MarkerTag;
export const Uri = monaco.Uri;
export const Token = monaco.Token;
export const editor = monaco.editor;
export const languages = monaco.languages;
