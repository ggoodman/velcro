import MagicString from 'magic-string';

import { parse } from '../ast';
import { traverse } from '../traverse';
import { Velcro } from '../velcro';
import { scopingAndRequiresVisitor, DependencyVisitorContext, collectGlobalsVisitor } from '../visitors';

export class CommonJsAsset implements Velcro.Asset {
  public readonly module: { exports: any } = { exports: {} };

  constructor(public readonly id: string, protected readonly host: Velcro.AssetHost) {}

  get exports() {
    return this.module.exports;
  }

  async load() {
    const code = await CommonJsAsset.loadCode(this.id, this.host);
    const module = await CommonJsAsset.loadModule(this.id, code, this.host, true);

    return module;
  }

  protected static async loadCode(id: string, host: Velcro.AssetHost) {
    const contentBuf = await host.readFileContent(id);
    const code = host.decodeBuffer(contentBuf);

    return code;
  }

  protected static async loadModule(id: string, code: string, host: Velcro.AssetHost, cacheable: boolean) {
    const magicString = new MagicString(code, {
      filename: id,
      indentExclusionRanges: [],
    });
    const requires = [] as string[];

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
                resolvedHref = await host.injectUnresolvedFallback(injectGlobal.spec, id);
              }

              const injected = `var ${globalName} = require(${JSON.stringify(resolvedHref)});\n`;
              magicString.prepend(injected);
              requires.push(resolvedHref);
            })
          );
        }
      }
    }

    for (const dep of ctx.requires) {
      resolvedRequirePromises.push(
        Promise.resolve(host.resolve(dep.value, id)).then(async resolvedHref => {
          if (!resolvedHref) {
            resolvedHref = await host.injectUnresolvedFallback(dep.value, id);
          }

          magicString.overwrite((dep as any).start!, (dep as any).end!, JSON.stringify(resolvedHref));
          requires.push(resolvedHref);
        })
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
        includeContent: false,
        source: id,
      })
      .toUrl();
    const codeWithMap = `${magicString.toString()}\n//# sourceMappingURL=${sourceMapUrl}`;

    return { cacheable, code: codeWithMap, dependencies: requires, type: Velcro.ModuleKind.CommonJs };
  }
}
