import { Resolver, ResolvedEntryKind, AbstractResolverHost, ResolvedEntry } from '@velcro/resolver';
import * as Monaco from 'monaco-editor';
import { timeout } from 'ts-primitives';

import { InvariantError, TimeoutError, TranspileError, Diagnostic } from './error';

const LANGUAGE_TYPESCRIPT = 'typescript';
const MAX_TRANSPILE_ATTEMPTS = 3;
const TRANSPILE_TIMEOUT = 2000;
const TRANSPILE_TIMEOUT_BACKOFF = 500;

type Model = Monaco.editor.ITextModel;

export class ResolverHostMonaco extends AbstractResolverHost {
  constructor(private readonly rootUri: Monaco.Uri = Monaco.Uri.file('/')) {
    super();
  }

  get rootHref() {
    return this.rootUri.toString(true);
  }

  async getResolveRoot() {
    return new URL(this.rootUri.toString(true));
  }

  async listEntries(_resolver: Resolver, url: URL) {
    const href = url.href.replace(/\/?$/, '/');
    const rootHref = this.rootUri.toString(true);

    if (!href.startsWith(rootHref)) {
      return [];
    }

    return Monaco.editor.getModels().reduce(
      (entries, model) => {
        const modelHref = model.uri.toString(true);
        const seenDirs = new Set<string>();

        if (modelHref.startsWith(href)) {
          const nestedPath = modelHref.slice(href.length);
          const nextDirIdx = nestedPath.indexOf('/');

          if (nextDirIdx === 0) {
            throw new Error('Invariant error: WAT?');
          }

          if (nextDirIdx > 0) {
            // This is an intermediate directory
            const url = new URL(nestedPath.slice(0, nextDirIdx + 1), href);

            if (!seenDirs.has(url.href)) {
              entries.push({
                type: ResolvedEntryKind.Directory,
                url,
              });
            }
          } else {
            entries.push({
              type: ResolvedEntryKind.File,
              url: new URL(modelHref),
            });
          }
        }

        return entries;
      },
      [] as ResolvedEntry[]
    );
  }

  async readFileContent(_resolver: Resolver, url: URL) {
    const href = url.href;

    if (!href.startsWith(this.rootHref)) {
      throw new InvariantError(
        `Attempting to read file content for a model at '${href}' outside of this host's root '${this.rootHref}'`
      );
    }

    const pathname = href.slice(this.rootHref.length);
    const model = Monaco.editor.getModel(Monaco.Uri.file(pathname));

    if (!model) {
      throw new InvariantError(`Attempting to read file content for a model that doesn't exist at '${href}'`);
    }

    const encoder = new TextEncoder();
    const output = await this.getTranspiledValue(model);

    return encoder.encode(output);
  }

  private async getTranspiledValue(model: Monaco.editor.ITextModel) {
    if (model.getModeId() === LANGUAGE_TYPESCRIPT) {
      const href = model.uri.toString(true);

      const tryLoadFromWorker = async () => {
        const workerFactory = await Monaco.languages.typescript.getTypeScriptWorker();
        const workerClient = await workerFactory(model.uri);
        const [emitOutput, syntacticDiagnostics] = (await Promise.all([
          workerClient.getEmitOutput(href),
          workerClient.getSyntacticDiagnostics(href),
        ])) as [import('typescript').EmitOutput, import('typescript').Diagnostic[]];

        if (emitOutput.emitSkipped) {
          throw new InvariantError(`Emit skipped when trying to read '${model.uri.fsPath}'`);
        }

        if (syntacticDiagnostics.length) {
          const diagnostics: Diagnostic[] = syntacticDiagnostics.map(diagnostic => {
            const startPosition =
              typeof diagnostic.start === 'number' ? model.getPositionAt(diagnostic.start) : undefined;
            const endPosition =
              typeof diagnostic.start === 'number' && typeof diagnostic.length === 'number'
                ? model.getPositionAt(diagnostic.start + diagnostic.length)
                : undefined;

            return {
              message: flattenDiagnosticMessageText(diagnostic.messageText),
              start: startPosition ? { lineNumber: startPosition.lineNumber, column: startPosition.column } : undefined,
              end: endPosition ? { lineNumber: endPosition.lineNumber, column: endPosition.column } : undefined,
              href: diagnostic.source,
            };
          });
          throw new TranspileError(`${syntacticDiagnostics[0].messageText} at ${model.uri.fsPath}`, diagnostics);
        }

        return emitOutput.outputFiles[0].text;
      };

      let attempt = 0;

      while (attempt++ < MAX_TRANSPILE_ATTEMPTS) {
        try {
          const code = await raceTimeout(tryLoadFromWorker(), TRANSPILE_TIMEOUT);

          return code;
        } catch (err) {
          if (err instanceof TimeoutError) {
            await timeout(TRANSPILE_TIMEOUT_BACKOFF * Math.pow(2, attempt));
            continue;
          }

          throw err;
        }
      }

      throw new TimeoutError(`Timed out while trying to transpile '${href}'`);
    }

    return model.getValue();
  }
}

export function flattenDiagnosticMessageText(
  diag: string | import('typescript').DiagnosticMessageChain | undefined,
  newLine: string = '\n',
  indent = 0
): string {
  if (typeof diag === 'string') {
    return diag;
  } else if (diag === undefined) {
    return '';
  }
  let result = '';
  if (indent) {
    result += newLine;

    for (let i = 0; i < indent; i++) {
      result += '  ';
    }
  }
  result += diag.messageText;
  indent++;
  if (diag.next) {
    for (const kid of diag.next) {
      result += flattenDiagnosticMessageText(kid, newLine, indent);
    }
  }
  return result;
}

function raceTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    timeout(timeoutMs).then(() => {
      return Promise.reject(new TimeoutError());
    }),
  ]);
}
