import { Node } from 'estree';

import { NodeWithParent } from './ast';

type VisitorContext = {
  skip(): void;
};

type EnterFunction<TContext> = (
  this: VisitorContext,
  node: NodeWithParent,
  parent: NodeWithParent | null,
  ctx: TContext,
  prop?: string,
  index?: number
) => void;
type LeaveFunction<TContext> = (
  node: NodeWithParent,
  parent: NodeWithParent | null,
  ctx: TContext,
  prop?: string,
  index?: number
) => void;

export type Visitor<TContext> = { enter?: EnterFunction<TContext>; leave?: LeaveFunction<TContext> };

export function traverse<TContext>(ast: Node, ctx: TContext, { enter, leave }: Visitor<TContext>) {
  visit(ast as NodeWithParent, null, ctx, enter, leave);
}

let shouldSkip = false;
const context = { skip: () => (shouldSkip = true) };

export const childKeys: {
  [key: string]: string[];
} = {};

function visit<TContext>(
  node: NodeWithParent,
  parent: NodeWithParent | null,
  ctx: TContext,
  enter?: EnterFunction<TContext>,
  leave?: LeaveFunction<TContext>,
  prop?: string,
  index?: number
) {
  if (!node) return;

  node.parent = parent;

  if (enter) {
    const _shouldSkip = shouldSkip;
    shouldSkip = false;
    enter.call(context, node, parent, ctx, prop, index);
    const skipped = shouldSkip;
    shouldSkip = _shouldSkip;

    if (skipped) return;
  }

  const keys =
    childKeys[node.type] ||
    (childKeys[node.type] = Object.keys(node).filter(
      key => key !== 'parent' && typeof (node as any)[key] === 'object'
    ));

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = (node as any)[key] as NodeWithParent | NodeWithParent[];

    if (Array.isArray(value)) {
      for (let j = 0; j < value.length; j++) {
        visit(value[j], node, ctx, enter, leave, key, j);
      }
    } else if (value && value.type) {
      visit(value, node, ctx, enter, leave, key);
    }
  }

  if (leave) {
    leave(node, parent, ctx, prop, index);
  }
}
