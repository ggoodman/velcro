import MagicString from 'magic-string';

import { Runtime } from '../runtime';

export class JsonAsset implements Runtime.Asset {
  public readonly fileDependencies = new Set<string>();
  public readonly module = { exports: {} };

  constructor(public readonly id: string, private readonly host: Runtime.AssetHost) {}

  get exports() {
    return this.module.exports;
  }

  async load() {
    const contentBuf = await this.host.readFileContent(this.id);
    const code = this.host.decodeBuffer(contentBuf);

    const magicString = new MagicString(code, {
      filename: this.id,
      indentExclusionRanges: [],
    });

    magicString.prepend('"use strict";\nmodule.exports = ');

    const sourceMapUrl = magicString
      .generateMap({
        includeContent: false,
        source: this.id,
      })
      .toUrl();
    const codeWithMap = `${magicString.toString()}\n//# sourceMappingURL=${sourceMapUrl}`;

    return {
      cacheable: true,
      code: codeWithMap,
      dependencies: [],
      type: Runtime.ModuleKind.CommonJs,
    };
  }
}
