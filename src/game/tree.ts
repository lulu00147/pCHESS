export interface MoveNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly ply: number;
  readonly uci: string;
  readonly san?: string;
  readonly fenAfter: string;
  readonly comment?: string;
  readonly nags?: readonly number[];
  readonly children: readonly string[];
  readonly createdAt: number;
}

export interface GameTree {
  readonly rootFen: string;
  readonly nodes: Readonly<Record<string, MoveNode>>;
  readonly cursorId: string;
}

export interface MoveInput {
  readonly uci: string;
  readonly fenAfter: string;
  readonly san?: string;
  readonly comment?: string;
  readonly nags?: readonly number[];
}

export const ROOT_ID = 'root';

export function createGameTree(rootFen: string, now = Date.now()): GameTree {
  const root: MoveNode = {
    id: ROOT_ID,
    parentId: null,
    ply: 0,
    uci: '',
    fenAfter: rootFen,
    children: [],
    createdAt: now,
  };
  return { rootFen, nodes: { [ROOT_ID]: root }, cursorId: ROOT_ID };
}

export function rootNode(tree: GameTree): MoveNode {
  const root = tree.nodes[ROOT_ID];
  if (!root) throw new Error('game tree has no root');
  return root;
}

export function nodeById(tree: GameTree, id: string): MoveNode {
  const node = tree.nodes[id];
  if (!node) throw new Error(`unknown move node: ${id}`);
  return node;
}

function uniqueId(tree: GameTree, parentId: string, uci: string): string {
  const base = `${parentId}/${uci}`;
  if (!tree.nodes[base]) return base;
  let suffix = 2;
  while (tree.nodes[`${base}~${suffix}`]) suffix += 1;
  return `${base}~${suffix}`;
}

export function addMove(
  tree: GameTree,
  parentId: string,
  input: MoveInput,
  now = Date.now(),
): { readonly tree: GameTree; readonly nodeId: string } {
  const parent = nodeById(tree, parentId);
  const existing = parent.children.find((id) => tree.nodes[id]?.uci === input.uci);
  if (existing) {
    return { tree: { ...tree, cursorId: existing }, nodeId: existing };
  }

  const id = uniqueId(tree, parentId, input.uci);
  const node: MoveNode = {
    id,
    parentId,
    ply: parent.ply + 1,
    uci: input.uci,
    fenAfter: input.fenAfter,
    ...(input.san === undefined ? {} : { san: input.san }),
    ...(input.comment === undefined ? {} : { comment: input.comment }),
    ...(input.nags === undefined ? {} : { nags: input.nags }),
    children: [],
    createdAt: now,
  };

  return {
    tree: {
      ...tree,
      cursorId: id,
      nodes: {
        ...tree.nodes,
        [parentId]: { ...parent, children: [...parent.children, id] },
        [id]: node,
      },
    },
    nodeId: id,
  };
}

export function moveCursor(tree: GameTree, id: string): GameTree {
  nodeById(tree, id);
  return { ...tree, cursorId: id };
}

export function pathToNode(tree: GameTree, id: string): MoveNode[] {
  const path: MoveNode[] = [];
  let current: MoveNode | undefined = nodeById(tree, id);
  while (current) {
    path.push(current);
    current = current.parentId ? tree.nodes[current.parentId] : undefined;
  }
  return path.reverse();
}

export function firstNode(tree: GameTree): GameTree {
  return moveCursor(tree, ROOT_ID);
}

export function predecessor(tree: GameTree): GameTree {
  const node = nodeById(tree, tree.cursorId);
  return node.parentId ? moveCursor(tree, node.parentId) : tree;
}

export function successor(tree: GameTree, childId?: string): GameTree {
  const node = nodeById(tree, tree.cursorId);
  const next = childId ?? node.children[0];
  if (!next) return tree;
  if (!node.children.includes(next)) throw new Error(`not a child of ${node.id}: ${next}`);
  return moveCursor(tree, next);
}

export function lastNode(tree: GameTree): GameTree {
  let current = nodeById(tree, tree.cursorId);
  while (current.children[0]) current = nodeById(tree, current.children[0]);
  return moveCursor(tree, current.id);
}

export function deleteSubtree(tree: GameTree, id: string): GameTree {
  if (id === ROOT_ID) throw new Error('cannot delete the root node');
  const target = nodeById(tree, id);
  const parent = target.parentId ? nodeById(tree, target.parentId) : null;
  if (!parent) throw new Error('node has no parent');

  const removed = new Set<string>();
  const visit = (nodeId: string): void => {
    removed.add(nodeId);
    for (const child of tree.nodes[nodeId]?.children ?? []) visit(child);
  };
  visit(id);

  const nodes: Record<string, MoveNode> = {};
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    if (!removed.has(nodeId)) nodes[nodeId] = node;
  }
  nodes[parent.id] = {
    ...parent,
    children: parent.children.filter((childId) => childId !== id),
  };

  return {
    ...tree,
    nodes,
    cursorId: removed.has(tree.cursorId) ? parent.id : tree.cursorId,
  };
}

export function mainline(tree: GameTree): MoveNode[] {
  const line: MoveNode[] = [];
  let current = rootNode(tree);
  while (current.children[0]) {
    current = nodeById(tree, current.children[0]);
    line.push(current);
  }
  return line;
}
