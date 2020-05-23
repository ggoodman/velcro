import { Plugin } from '@velcro/bundler';

export function cssPlugin(): Plugin {
  return {
    name: 'cssPlugin',
    transform({ magicString }, uri, code) {
      if (!uri.path.endsWith('.css')) {
        return;
      }

      const cssCode = code;
      const BACKSLASH = '\\'.charCodeAt(0);
      const SINGLE_QUOTE = "'".charCodeAt(0);
      const NL = '\n'.charCodeAt(0);
      const CR = '\r'.charCodeAt(0);

      let escaped = false;

      for (let i = 0; i < cssCode.length; i++) {
        const char = cssCode.charCodeAt(i);

        if (char === BACKSLASH) {
          escaped = !escaped;
          continue;
        }

        if (!escaped) {
          // Escape certain characters (if not already escaped)
          switch (char) {
            case CR:
            case NL:
              magicString.overwrite(i, i + 1, ' ');
              break;
            case SINGLE_QUOTE:
              magicString.prependRight(i, '\\');
              break;
          }
        }

        escaped = false;
      }

      magicString.prepend(`
        function reload(){
          var styleTag = document.createElement("style");
          styleTag.type = "text/css";
          styleTag.innerHTML = '`);
      magicString.append(`';
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
      `);

      return {
        code: magicString.toString(),
        sourceMaps: [magicString.generateDecodedMap()],
      };
    },
  };
}
