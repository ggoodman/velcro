import { Uri } from '@velcro/common';
import { parse } from './parser';

describe('parseCss', () => {
  it('will collect dependencies', () => {
    const code = `
      @import "foo/bar.css";
      @import "foo/bar.css" (min-width: 25em);
      @import url(foo/bar.css);
      @import url(foo/bar.css) (min-width: 25em);
      @import url("foo/bar.css");
      @import url("foo/bar.css") (min-width: 25em);
      @import url('foo/bar.css');
      @import url('foo/bar.css') (min-width: 25em);
      @import url(foo/bar.css) only screen and (min-width: 25em) and (orientation: landscape);
      @import url(foo/bar.css) only screen and (min-width: 25em);
    `.trim();
    const result = parse(Uri.file('style.css'), code, {
      globalModules: {},
      nodeEnv: 'development',
    });

    expect(result.dependencies.length).toBe(code.split('\n').length);
    expect(result.dependencies.every((dep) => dep.spec === 'foo/bar.css')).toBe(true);
  });
});
