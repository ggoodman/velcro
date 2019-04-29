import MagicString from 'magic-string';

import { parse } from '../ast';
import { traverse } from '../traverse';
import { Runtime } from '../runtime';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from '../visitors';

export class CommonJsAsset implements Runtime.Asset {
  public readonly fileDependencies = new Set<string>();
  public readonly module: { exports: any } = { exports: {} };

  constructor(public readonly id: string, protected readonly host: Runtime.AssetHost) {}

  get exports() {
    return this.module.exports;
  }

  async load() {
    const code = await CommonJsAsset.loadCode(this.id.replace(/^!+/, ''), this.host);
    const module = await CommonJsAsset.loadModule(this.id.replace(/^!+/, ''), code, this.host, true);

    return module;
  }

  protected static async loadCode(id: string, host: Runtime.AssetHost) {
    const contentBuf = await host.readFileContent(id);
    const code = host.decodeBuffer(contentBuf);

    return code;
  }

  protected static async loadModule(id: string, code: string, host: Runtime.AssetHost, cacheable: boolean) {
    const magicString = new MagicString(code, {
      filename: id,
      indentExclusionRanges: [],
    });
    const dependencies = [] as string[];
    const ctx: DependencyVisitorContext = {
      injectGlobals: new Set(),
      locals: new Map(),
      nodeEnv: 'development',
      replacements: [],
      requires: [],
      resolves: [],
      skip: new Set(),
    };

    try {
      const ast = parse(code);

      traverse(ast, ctx, scopingAndRequiresVisitor);

      if (host.injectGlobal) {
        traverse(ast, ctx, collectGlobalsVisitor);
      }
    } catch (err) {
      throw new Error(`Error parsing ${id}: ${err.message}`);
    }

    const resolvedInjectPromises = [] as Promise<void>[];
    const resolvedRequirePromises = [] as Promise<void>[];
    const resolvedResolvePromises = [] as Promise<void>[];

    if (host.injectGlobal) {
      for (const globalName of ctx.injectGlobals) {
        const injectGlobal = host.injectGlobal(globalName);

        if (injectGlobal) {
          resolvedInjectPromises.push(
            Promise.resolve(host.resolve(injectGlobal.spec, id)).then(async resolvedHref => {
              if (!resolvedHref) {
                throw new Error(
                  `Failed to resolve the module ${injectGlobal.spec} from ${id} for the global ${globalName}`
                );
              }

              const injected = `var ${globalName} = require(${JSON.stringify(resolvedHref)});\n`;
              magicString.prepend(injected);
              dependencies.push(resolvedHref);
            })
          );
        }
      }
    }

    for (const dep of ctx.requires) {
      resolvedRequirePromises.push(
        (async () => {
          // const rawSpec = await getRawSpec(dep.value, id, host);
          const parts = dep.value.split('!');

          for (const idx in parts) {
            const part = parts[idx];

            if (part) {
              const resolvedPart = await host.resolve(part, id);

              if (!resolvedPart) {
                throw new Error(
                  `Failed to resolve ${part}, which is required for the webpack loader resource ${
                    dep.value
                  }, required by ${id}`
                );
              }

              parts[idx] = resolvedPart;
            }
          }

          const spec = parts.join('!');

          magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(spec));
          dependencies.push(spec);
        })()
      );
    }

    for (const dep of ctx.resolves) {
      resolvedResolvePromises.push(
        Promise.resolve(host.resolve(dep.value, id)).then(resolvedHref => {
          // TODO: How can we alert users that this 'failed' if resolvedHref is `undefined`
          magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(resolvedHref));
        })
      );
    }

    const promises = [...resolvedInjectPromises, ...resolvedRequirePromises, ...resolvedResolvePromises];

    if (promises.length) {
      await Promise.all(promises);
    }

    for (const replacement of ctx.replacements) {
      magicString.overwrite(replacement.start, replacement.end, replacement.replacement);
    }

    const sourceMapUrl = magicString
      .generateMap({
        includeContent: !id.match(/^https?:\/\//),
        source: id,
      })
      .toUrl();
    const codeWithMap = `${magicString.toString()}\n//# sourceMappingURL=${sourceMapUrl}`;

    return { cacheable, code: codeWithMap, dependencies, type: Runtime.ModuleKind.CommonJs };
  }
}

// async function getRawSpec(id: string, fromId: string, host: Runtime.AssetHost): Promise<string> {
//   if (id.startsWith('!')) {
//     return id;
//   }

//   const parts = [id];

//   if (id.endsWith('.css')) {
//     parts.unshift('style-loader', 'css-loader');
//   }

//   const resolvedParts = await Promise.all(parts.map(part => host.resolve(part, fromId)));

//   return resolvedParts.length > 1 ? `!!${parts.join('!')}` : parts[0];
// }
