import { parse as acornParse } from 'acorn';
import {
  ArrayPattern,
  ArrowFunctionExpression,
  AssignmentPattern,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  ClassDeclaration,
  Function,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  Literal,
  MemberExpression,
  Node,
  ObjectPattern,
  Program,
  Property,
  RestElement,
  SimpleLiteral,
  ThisExpression,
  TryStatement,
  VariableDeclaration,
} from 'estree';

export type NodeWithParent<TNode = Node> = TNode & {
  parent: NodeWithParent | null;
};
export type NodeWithStartAndEnd<TNode = Node> = TNode & {
  start: number;
  end: number;
};

export interface StringLiteral extends SimpleLiteral {
  value: string;
}

export function isArrowFunctionExpression(node: Node): node is ArrowFunctionExpression {
  return node.type === 'ArrowFunctionExpression';
}

export function isArrayPattern(node: Node): node is ArrayPattern {
  return node.type === 'ArrayPattern';
}

export function isAssignmentPattern(node: Node): node is AssignmentPattern {
  return node.type === 'AssignmentPattern';
}

export function isBinaryExpression(node: Node): node is BinaryExpression {
  return node.type === 'BinaryExpression';
}

export function isBlockStatement(node: Node): node is BlockStatement {
  return node.type === 'BlockStatement';
}

export function isCallExpression(node: Node): node is CallExpression {
  return node.type === 'CallExpression';
}

export function isClassDeclaration(node: Node): node is ClassDeclaration {
  return node.type === 'ClassDeclaration';
}

export function isFunctionDeclaration(node: Node): node is FunctionDeclaration {
  return node.type === 'FunctionDeclaration';
}

export function isFunctionExpression(node: Node): node is FunctionExpression {
  return node.type === 'FunctionExpression';
}

export function isIdentifier(node: Node): node is Identifier {
  return node.type === 'Identifier';
}

export function isIfStatement(node: Node): node is IfStatement {
  return node.type === 'IfStatement';
}

export function isLiteral(node: Node): node is Literal {
  return node.type === 'Literal';
}

export function isMemberExpression(node: Node): node is MemberExpression {
  return node.type === 'MemberExpression';
}

export function isNodeWithStartAndEnd<T extends Node>(node: T): node is NodeWithStartAndEnd<T> {
  return typeof (node as any).start === 'number' && typeof (node as any).end === 'number';
}

export function isObjectPattern(node: Node): node is ObjectPattern {
  return node.type === 'ObjectPattern';
}

export function isProperty(node: Node): node is Property {
  return node.type === 'Property';
}

export function isRestElement(node: Node): node is RestElement {
  return node.type === 'RestElement';
}

export function isProgram(node: Node): node is Program {
  return node.type === 'Program';
}

export function isThisExpression(node: Node): node is ThisExpression {
  return node.type === 'ThisExpression';
}

export function isTryStatement(node: Node): node is TryStatement {
  return node.type === 'TryStatement';
}

export function isVariableDeclaration(node: Node): node is VariableDeclaration {
  return node.type === 'VariableDeclaration';
}

// Refinements or groups
export function isFunction(node: Node): node is Function {
  return (
    isFunctionDeclaration(node) || isFunctionExpression(node) || isArrowFunctionExpression(node)
  );
}

export function isStringLiteral(node: Node): node is StringLiteral {
  return isLiteral(node) && typeof node.value === 'string';
}

export function parse(code: string, options?: acorn.Options) {
  return (acornParse(code, {
    ...options,
    allowReturnOutsideFunction: true,
    sourceType: 'script',
  }) as any) as Program;
}
