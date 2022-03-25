import type { Context } from '@ggoodman/context';
import { TextDecoder } from 'util';
import { JsDelivrCdn, ResolverCdn } from './cdn';
import {
  CanonicalizedModuleReference,
  isCanonicalizedModuleReference,
  ModuleReference,
  ModuleReferenceImpl,
} from './references';
import { assertPackageJsonWithNameAndVersion } from './types';
import { parseBareModuleSpec } from './util/specs';
import { isThenable } from './util/thenables';

export class BareModuleResolver {
  private cdn: ResolverCdn = new JsDelivrCdn();
  private decoder = new TextDecoder();

  async resolve(
    ctx: Context,
    spec: string,
    fromRef: ModuleReference
  ): Promise<CanonicalizedModuleReference> {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const relRef = fromRef.withRelativePath(spec);
      return isCanonicalizedModuleReference(relRef)
        ? relRef
        : this.cdn.canonicalizeRef(ctx, relRef);
    }

    const parsedSpec = parseBareModuleSpec(spec);

    if (!parsedSpec) {
      throw new TypeError(
        `Failed to parse ${JSON.stringify(spec)} as a bare module specifier`
      );
    }

    const canonicalizedFromRefRet = this.cdn.canonicalizeRef(ctx, fromRef);
    const canonicalizedFromRef = isThenable(canonicalizedFromRefRet)
      ? await canonicalizedFromRefRet
      : canonicalizedFromRefRet;
    const packageJsonRef = canonicalizedFromRef.with({ path: '/package.json' });
    const fromPackageJsonBufRet = this.cdn.readFileContents(
      ctx,
      packageJsonRef
    );
    const fromPackageJsonBuf = isThenable(fromPackageJsonBufRet)
      ? await fromPackageJsonBufRet
      : fromPackageJsonBufRet;

    const fromPackageJson = JSON.parse(this.decoder.decode(fromPackageJsonBuf));

    const toName = parsedSpec.name;
    const toSpec =
      fromPackageJson['dependencies']?.[toName] ??
      fromPackageJson['devDependencies']?.[toName];

    if (typeof toSpec !== 'string') {
      throw new Error(
        `Failed to find ${JSON.stringify(spec)} in the dependencies of ${
          fromRef.name
        }@${fromRef.spec}${fromRef.path}`
      );
    }

    const ref = this.cdn.createReference(toName, toSpec, parsedSpec.spec);

    return isCanonicalizedModuleReference(ref)
      ? ref
      : this.cdn.canonicalizeRef(ctx, ref);
  }
}
