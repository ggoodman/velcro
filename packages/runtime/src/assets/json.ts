import MagicString from 'magic-string';

import { Velcro } from '../velcro';

export class JsonAsset implements Velcro.Asset {
  public readonly module = { exports: {} };

  constructor(public readonly id: string, private readonly host: Velcro.AssetHost) {}

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
      type: Velcro.ModuleKind.CommonJs,
    };
  }
}
