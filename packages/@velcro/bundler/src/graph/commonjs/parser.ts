import type { BinaryOperator, Function, Identifier, MemberExpression, Node, Pattern } from 'estree';
import MagicString from 'magic-string';
import { ParserFunction } from '../parsing';
import { DEFAULT_SHIM_GLOBALS } from '../shims';
import { SourceModuleDependency } from '../sourceModuleDependency';
import {
  isArrayPattern,
  isArrowFunctionExpression,
  isAssignmentPattern,
  isBinaryExpression,
  isBlockStatement,
  isCallExpression,
  isClassDeclaration,
  isFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isMemberExpression,
  isObjectPattern,
  isProgram,
  isProperty,
  isRestElement,
  isStringLiteral,
  isThisExpression,
  isTryStatement,
  isVariableDeclaration,
  NodeWithParent,
  parse as parseAst,
} from './ast';
import { traverse, Visitor } from './traverse';

declare module 'estree' {
  export interface BaseNodeWithoutComments {
    start: number;
    end: number;
  }
}

export const parse = function parseJavaScript(
  code: string,
  options: {
    globalModules: typeof DEFAULT_SHIM_GLOBALS;
    nodeEnv: string;
  }
): ReturnType<ParserFunction> {
  const visitorCtx: DependencyVisitorContext = {
    unboundSymbols: new Map(),
    locals: new Map(),
    magicString: new MagicString(code),
    nodeEnv: options.nodeEnv,
    replacedSymbols: new Set<Identifier>(),
    requires: [],
    requireResolves: [],
    skip: new Set(),
    skipTransform: new Set(),
  };
  const dependencies = [] as SourceModuleDependency[];

  // let lastToken: Token | undefined;
  const ast = parseAst(code, {
    // onComment: (_isBlock, _test, start, end) => {
    //   result.changes.push({ type: 'remove', start, end });
    // },
    // onInsertedSemicolon(lastTokEnd) {
    //   result.changes.push({ type: 'appendRight', position: lastTokEnd, value: ';' });
    // },
    // onToken: (token) => {
    //   const start = lastToken ? lastToken.end + 1 : 0;
    //   const end = token.start;
    //   if (end > start) {
    //     result.changes.push({ type: 'remove', start, end });
    //   }
    //   lastToken = token;
    // },
  });

  traverse(ast, visitorCtx, scopingAndRequiresVisitor);
  traverse(ast, visitorCtx, collectGlobalsVisitor);

  // Handle explicit requires
  const requiresBySpec = new Map<string, Array<{ start: number; end: number }>>();
  for (const requireDependency of visitorCtx.requires) {
    let locations = requiresBySpec.get(requireDependency.spec.value);
    if (!locations) {
      locations = [];
      requiresBySpec.set(requireDependency.spec.value, locations);
    }

    locations.push({ start: requireDependency.spec.start, end: requireDependency.spec.end });
  }
  for (const [spec, locations] of requiresBySpec) {
    dependencies.push(SourceModuleDependency.fromRequire(spec, locations));
  }

  // Handle require.resolve
  const requireResolvesBySpec = new Map<string, Array<{ start: number; end: number }>>();
  for (const requireDependency of visitorCtx.requireResolves) {
    let locations = requiresBySpec.get(requireDependency.spec.value);
    if (!locations) {
      locations = [];
      requiresBySpec.set(requireDependency.spec.value, locations);
    }

    locations.push({ start: requireDependency.spec.start, end: requireDependency.spec.end });
  }
  for (const [spec, locations] of requireResolvesBySpec) {
    dependencies.push(SourceModuleDependency.fromRequireResolve(spec, locations));
  }

  for (const [symbolName, locations] of visitorCtx.unboundSymbols) {
    const shim = options.globalModules[symbolName];

    if (shim) {
      dependencies.push(SourceModuleDependency.fromGloblaObject(shim.spec, locations, shim.export));
    }
  }

  return {
    code: visitorCtx.magicString,
    dependencies,
  };
};

export type CommonJsRequire = {
  callee: { start: number; end: number };
  spec: { start: number; end: number; value: string };
};

export type CommonJsRequireResolve = {
  callee: { start: number; end: number };
  spec: { start: number; end: number; value: string };
};

export type DependencyVisitorContext = {
  readonly unboundSymbols: Map<string, Node[]>;
  readonly locals: Map<Node, { [identifier: string]: boolean }>;
  readonly magicString: MagicString;
  readonly nodeEnv: string;
  readonly requires: CommonJsRequire[];
  readonly replacedSymbols: Set<Identifier>;
  readonly requireResolves: CommonJsRequireResolve[];
  readonly skip: Set<Node>;
  readonly skipTransform: Set<Node>;
};

export const scopingAndRequiresVisitor: Visitor<DependencyVisitorContext> = {
  enter(node, parent, ctx) {
    // Get AST-node level locations in the source map
    ctx.magicString.addSourcemapLocation(node.start);
    ctx.magicString.addSourcemapLocation(node.end);

    if (ctx.skip.has(node)) {
      return this.skip();
    }

    visitAndCaptureScoping(node, parent, ctx);
    visitAndSkipBranches(node, parent, ctx);
    visitRequires(node, parent, ctx);
  },
  leave(node, _parent, ctx) {
    let skipped = false;
    let nextCheck: NodeWithParent<Node> | undefined = node;

    while (nextCheck) {
      if (ctx.skipTransform.has(nextCheck)) {
        skipped = true;
        break;
      }

      nextCheck = nextCheck.parent as NodeWithParent<Node> | undefined;
    }

    if (
      !skipped &&
      isMemberExpression(node) &&
      memberExpressionMatches(node, 'process.env.NODE_ENV')
    ) {
      ctx.magicString.overwrite(node.start, node.end, JSON.stringify(ctx.nodeEnv), {
        contentOnly: true,
        storeName: true,
      });
      ctx.skip.add(node);
      ctx.skipTransform.add(node);
    }
  },
};

export const collectGlobalsVisitor: Visitor<DependencyVisitorContext> = {
  enter(node, _parent, ctx) {
    if (ctx.skip.has(node)) {
      return this.skip();
    }

    if (isBindingIdentifier(node) && isIdentifier(node)) {
      var name = node.name;
      if (name === 'undefined') return;
      if (ctx.replacedSymbols.has(node)) {
        return;
      }

      let foundBinding = false;
      let nextParent = node.parent;

      while (nextParent) {
        if (name === 'arguments' && declaresArguments(nextParent)) {
          foundBinding = true;
          break;
        }

        const locals = ctx.locals.get(nextParent);

        if (locals && locals[name]) {
          foundBinding = true;
          break;
        }

        nextParent = nextParent.parent;
      }

      if (!foundBinding) {
        let unboundSymbols = ctx.unboundSymbols.get(name);
        if (!unboundSymbols) {
          unboundSymbols = [];
          ctx.unboundSymbols.set(name, unboundSymbols);
        }
        unboundSymbols.push(node);
      }
    } else if (isThisExpression(node)) {
      let foundBinding = false;
      let nextParent = node.parent;

      while (nextParent) {
        if (declaresThis(nextParent)) {
          foundBinding = true;
          break;
        }

        nextParent = nextParent.parent;
      }

      if (!foundBinding) {
        let unboundSymbols = ctx.unboundSymbols.get('this');
        if (!unboundSymbols) {
          unboundSymbols = [];
          ctx.unboundSymbols.set('this', unboundSymbols);
        }
        unboundSymbols.push(node);
      }
    }
  },
};

function visitAndCaptureScoping(
  node: NodeWithParent,
  _parent: NodeWithParent | null,
  ctx: DependencyVisitorContext
) {
  if (isVariableDeclaration(node)) {
    let parent: NodeWithParent | undefined;
    let nextParent = node.parent;

    while (nextParent) {
      if (node.kind === 'var' ? isScope(nextParent) : isBlockScope(nextParent)) {
        parent = nextParent;
        break;
      }

      nextParent = nextParent.parent;
    }

    if (!parent) {
      throw new Error(`Invariant violation: Failed to find a parent`);
    }

    let locals = ctx.locals.get(parent);

    if (!locals) {
      locals = {};
      ctx.locals.set(parent, locals);
    }

    for (const declaration of node.declarations) {
      declarePattern(declaration.id, locals);
    }
  } else if (isFunctionDeclaration(node)) {
    let parent: NodeWithParent | undefined;
    let nextParent = node.parent;

    if (nextParent && nextParent.parent) {
      nextParent = nextParent.parent;
    }

    while (nextParent) {
      if (isScope(nextParent)) {
        parent = nextParent;
        break;
      }

      nextParent = nextParent.parent;
    }

    if (!parent) {
      throw new Error(`Invariant violation: Failed to find a parent`);
    }

    let locals = ctx.locals.get(parent);

    if (!locals) {
      locals = {};
      ctx.locals.set(parent, locals);
    }

    declareFunction(node, locals);
  } else if (isFunction(node)) {
    let locals = ctx.locals.get(node);

    if (!locals) {
      locals = {};
      ctx.locals.set(node, locals);
    }

    declareFunction(node, locals);
  } else if (isClassDeclaration(node) && node.id) {
    let parent: NodeWithParent | undefined;
    let nextParent = node.parent;

    if (nextParent && nextParent.parent) {
      nextParent = nextParent.parent;
    }

    while (nextParent) {
      if (isScope(nextParent)) {
        parent = nextParent;
        break;
      }

      nextParent = nextParent.parent;
    }

    if (!parent) {
      throw new Error(`Invariant violation: Failed to find a parent`);
    }

    let locals = ctx.locals.get(parent);

    if (!locals) {
      locals = {};
      ctx.locals.set(parent, locals);
    }

    locals[node.id.name] = true;
  } else if (isTryStatement(node)) {
    if (node.handler) {
      let locals = ctx.locals.get(node.handler);

      if (!locals) {
        locals = {};
        ctx.locals.set(node.handler, locals);
      }

      if (node.handler.param) {
        declarePattern(node.handler.param, locals);
      }
    }
  }
}

function visitAndSkipBranches(
  node: NodeWithParent,
  _parent: NodeWithParent | null,
  ctx: DependencyVisitorContext
) {
  if (isIfStatement(node) && isBinaryExpression(node.test)) {
    const tests = {
      '!=': (l: string, r: string) => l != r,
      '!==': (l: string, r: string) => l !== r,
      '==': (l: string, r: string) => l == r,
      '===': (l: string, r: string) => l === r,
    } as { [key in BinaryOperator]: (l: string, r: string) => boolean };
    const test = tests[node.test.operator];

    if (test) {
      if (
        isStringLiteral(node.test.left) &&
        isMemberExpression(node.test.right) &&
        memberExpressionMatches(node.test.right, 'process.env.NODE_ENV')
      ) {
        let rootObject = node.test.right;
        while (isMemberExpression(rootObject.object)) {
          rootObject = rootObject.object;
        }
        if (isIdentifier(rootObject.object)) {
          ctx.replacedSymbols.add(rootObject.object);
        }

        ctx.skipTransform.add(node.test.right);

        // if ('development' === process.env.NODE_ENV) {}

        if (!test(node.test.left.value, ctx.nodeEnv)) {
          ctx.skip.add(node.consequent);
          // We can blow away the consequent
          ctx.magicString.remove(
            node.start,
            node.alternate ? node.alternate.start : node.consequent.end
          );
        } else {
          // We can blow away the test
          ctx.magicString.remove(node.start, node.consequent.start - 1);

          if (node.alternate) {
            ctx.skip.add(node.alternate);
            // We can blow away the alternate but we need to start and the end of the consequent + 1 char
            ctx.magicString.remove(node.consequent.end + 1, node.alternate.end);
          }
        }
      } else if (
        isStringLiteral(node.test.right) &&
        isMemberExpression(node.test.left) &&
        memberExpressionMatches(node.test.left, 'process.env.NODE_ENV')
      ) {
        let rootObject = node.test.left;
        while (isMemberExpression(rootObject.object)) {
          rootObject = rootObject.object;
        }
        if (isIdentifier(rootObject.object)) {
          ctx.replacedSymbols.add(rootObject.object);
        }

        ctx.skipTransform.add(node.test.left);

        // if (process.env.NODE_ENV === 'development') {}

        if (!test(node.test.right.value, ctx.nodeEnv)) {
          ctx.skip.add(node.consequent);
          // We can blow away the consequent
          ctx.magicString.remove(
            node.start,
            node.alternate ? node.alternate.start : node.consequent.end
          );
        } else {
          // We can blow away the test and the alternate
          ctx.magicString.remove(node.start, node.consequent.start - 1);

          if (node.alternate) {
            ctx.skip.add(node.alternate);
            // We can blow away the alternate but we need to start and the end of the consequent + 1 char
            ctx.magicString.remove(node.consequent.end + 1, node.alternate.end);
          }
        }
      }
    }
  }
}

function visitRequires(
  node: NodeWithParent,
  _parent: NodeWithParent | null,
  ctx: DependencyVisitorContext
) {
  if (isCallExpression(node)) {
    const callee = node.callee;
    if (isIdentifier(callee) && callee.name === 'require') {
      const firstArg = node.arguments[0];

      if (isStringLiteral(firstArg)) {
        ctx.requires.push({
          spec: { start: firstArg.start, end: firstArg.end, value: firstArg.value },
          callee: { start: callee.start, end: callee.end },
        });
      } else {
        console.warn('Non string-literal first arg to require', firstArg);
      }
    } else if (
      isMemberExpression(callee) &&
      isIdentifier(callee.object) &&
      callee.object.name === 'require' &&
      isIdentifier(callee.property) &&
      callee.property.name === 'resolve'
    ) {
      const firstArg = node.arguments[0];

      if (isStringLiteral(firstArg)) {
        ctx.requireResolves.push({
          spec: { start: firstArg.start, end: firstArg.end, value: firstArg.value },
          callee: { start: callee.start, end: callee.end },
        });
      } else {
        console.warn('Non string-literal first arg to require.resolve', firstArg);
      }
    }
  }
}

function declareFunction(node: Function, locals: { [name: string]: boolean }) {
  node.params.forEach(function (node) {
    declarePattern(node, locals);
  });
  if ((node as any).id) {
    locals[(node as any).id.name] = true;
  }
}

function declarePattern(node: Pattern, locals: { [name: string]: boolean }) {
  if (isIdentifier(node)) {
    locals[node.name] = true;
  } else if (isObjectPattern(node)) {
    node.properties.forEach((node) =>
      isRestElement(node)
        ? declarePattern(node.argument, locals)
        : declarePattern(node.value, locals)
    );
  } else if (isArrayPattern(node)) {
    node.elements.forEach((node) => node && declarePattern(node, locals));
  } else if (isRestElement(node)) {
    declarePattern(node.argument, locals);
  } else if (isAssignmentPattern(node)) {
    declarePattern(node.left, locals);
  } else {
    throw new Error(`Invariant violation: Unexpected pattern type: ${node.type}`);
  }
}

function isBindingIdentifier(node: NodeWithParent) {
  return isIdentifier(node) && !isPropertyOfMemberExpression(node) && !isKeyOfProperty(node);
}

function isKeyOfProperty(node: NodeWithParent) {
  return node.parent && isProperty(node.parent) && node.parent.key === node;
}

function isPropertyOfMemberExpression(node: NodeWithParent) {
  return node.parent && isMemberExpression(node.parent) && node.parent.object !== node;
}

function isScope(node: NodeWithParent) {
  return (
    isFunctionDeclaration(node) ||
    isFunctionExpression(node) ||
    isArrowFunctionExpression(node) ||
    isProgram(node)
  );
}

function isBlockScope(node: NodeWithParent) {
  return isBlockStatement(node) || isScope(node);
}

function declaresArguments(node: NodeWithParent) {
  return isFunctionDeclaration(node) || isFunctionExpression(node);
}

function declaresThis(node: NodeWithParent) {
  return isFunctionDeclaration(node) || isFunctionExpression(node);
}

function memberExpressionMatches(node: MemberExpression, pattern: string) {
  const memberParts = pattern.split('.');

  if (memberParts.length < 2) {
    return false;
  }

  const object = memberParts.shift();
  const property = memberParts.shift();

  for (let i = memberParts.length - 1; i >= 0; i--) {
    if (!isIdentifier(node.property) || node.property.name !== memberParts[i]) {
      return false;
    }

    if (!isMemberExpression(node.object)) {
      return false;
    }

    node = node.object;
  }

  if (!isIdentifier(node.object) || !isIdentifier(node.property)) {
    return false;
  }

  return node.object.name === object && node.property.name === property;
}
