import { parse } from 'acorn';

import * as ESTree from 'estree';

export function analyze(code: string, source?: string) {
  const ast = parse(code, {
    locations: true,
    sourceFile: source,
    
    globalReturn: true,
    loc: true,
    source,
  }) as ESTree.Program;

  withTraveralFunction((forEachChild) => {
    const visit = (node: ESTree.Node) => {
      forEachChild(node, (child) => {
        switch (child.type) {
          case 'CallExpression': {
            const callee = child.callee;
            const arguments = child.arguments;

            if (callee.type === 'Identifier' && callee.name === 'require' && arguments.length === 1) {
              const firstArg = arguments[1];

              if (firstArg.type === 'Literal')
            }
          }
        }
      });
    };

    visit(ast);
  });
}

type TraversalFunction = (
  forEachChild: <TNode extends ESTree.Node>(
    node: TNode,
    childVisitor: (childNode: ChildNodes<TNode>) => void
  ) => void
  // forEachAncestor: (node: ESTree.Node) => void
) => void;

type Properties<T> = Extract<T[keyof T], ESTree.Node | ESTree.Node[]>;
type Flatten<T> = T extends Array<infer U> ? U : T;
type ChildNodes<T extends ESTree.Node, TFlattened = Properties<T>> = Equals<T, ESTree.Node> extends 1 ? ESTree.Node : Flatten<TFlattened>; 

export type Equals<A1 extends any, A2 extends any> = (<A>() => A extends A2 ? 1 : 0) extends <
  A
>() => A extends A1 ? 1 : 0
  ? (<A>() => A extends A1 ? 1 : 0) extends <A>() => A extends A2 ? 1 : 0
    ? 1
    : 0
  : 0;

// type Test = ChildNodes<ESTree.SimpleCallExpression>

function isNode(object: unknown): object is ESTree.Node {
  return object && typeof object === 'object' && typeof (object as any)['type'] === 'string';
}

function withTraveralFunction(traversalFn: TraversalFunction) {
  const parents = new WeakMap<ESTree.Node, ESTree.Node>();

  // function forEachAncestor(node: ESTree.Node) {}

  function forEachChild<TNode extends ESTree.Node>(
    node: TNode,
    childVisitor: (childNode: ChildNodes<TNode>) => void
  ) {
    for (const key in node) {
      const value = node[key];

      if (isNode(value)) {
        parents.set(value, node);
        childVisitor((value as unknown) as ChildNodes<TNode>);
      } else if (Array.isArray(value) && isNode(value[0])) {
        for (const child of value) {
          parents.set(child, node);
          childVisitor((child as unknown) as ChildNodes<TNode>);
        }
      }
    }
  }

  return traversalFn(forEachChild);
}
