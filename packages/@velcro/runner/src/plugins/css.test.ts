import { Uri } from '@velcro/common';
import MagicString from 'magic-string';
import { cssPlugin } from './css';

describe('cssPlugin', () => {
  it('will transpile css', async () => {
    const plugin = cssPlugin();
    const code = `
      h1:before{ content: "\\f101"; }
      h1 { background-image: url('img_tree.gif'); }
    `;
    const result = await plugin.transform!(
      {
        createMagicString() {
          return new MagicString(code);
        },
      } as any,
      Uri.file('index.css'),
      code
    );

    expect(result?.code).toMatchInlineSnapshot(`
      "
              function reload(){
                var styleTag = document.createElement(\\"style\\");
                styleTag.type = \\"text/css\\";
                styleTag.innerHTML = '\\\\n'
      +'      h1:before{ content: \\"\\\\\\\\f101\\"; }\\\\n'
      +'      h1 { background-image: url(\\\\'img_tree.gif\\\\'); }\\\\n'
      +'    ';
                document.head.appendChild(styleTag);
                return {
                  dispose: function() {    
                    if (styleTag && styleTag.parentElement) {
                      styleTag.parentElement.removeChild(styleTag);
                    }
                  },
                  element: styleTag
                };
              };
              var result = reload();
              module.exports = result.element;
              if (module.hot && module.hot.dispose) {
                module.hot.dispose(function() {
                  result.dispose();
                });
              }
            "
    `);
  });
});
