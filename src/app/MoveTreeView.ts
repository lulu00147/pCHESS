import type { GameTree } from '../game/tree';

export interface MoveTreeOptions {
  readonly host: HTMLElement;
  readonly tree: GameTree;
  readonly prefix: string;
  readonly collapsed: Set<string>;
  readonly deleteLabel: string;
  readonly expandLabel: string;
  readonly collapseLabel: string;
  readonly confirmDelete: string;
  readonly onNavigate: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onChange: () => void;
}

export function renderMoveTree(options: MoveTreeOptions): void {
  const { tree, collapsed, prefix } = options;
  const list = document.createElement('ol');
  list.className = 'move-list';

  const appendChildren = (parentId: string, depth: number, variation: boolean): void => {
    const parent = tree.nodes[parentId];
    if (!parent) return;
    parent.children.forEach((childId, index) => {
      const node = tree.nodes[childId];
      if (!node) return;
      const childDepth = depth + (index === 0 ? 0 : 1);
      const childVariation = variation || index > 0;
      const item = document.createElement('li');
      const indentDepth = Math.min(childDepth, 8);
      item.style.paddingLeft = `${indentDepth * 14}px`;
      if (childVariation) item.dataset.variation = 'true';
      const key = `${prefix}:${node.id}`;
      const isCollapsed = collapsed.has(key);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'move-toggle';
      toggle.disabled = node.children.length === 0;
      toggle.textContent = node.children.length === 0 ? '' : isCollapsed ? '▸' : '▾';
      if (node.children.length > 0) {
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
        toggle.setAttribute(
          'aria-label',
          isCollapsed ? options.expandLabel : options.collapseLabel,
        );
        toggle.addEventListener('click', () => {
          if (isCollapsed) collapsed.delete(key);
          else collapsed.add(key);
          options.onChange();
        });
      }
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'move-button';
      move.textContent = node.san ?? node.uci;
      if (node.id === tree.cursorId) move.setAttribute('aria-current', 'step');
      move.addEventListener('click', () => options.onNavigate(node.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'move-delete';
      remove.textContent = '×';
      remove.setAttribute('aria-label', options.deleteLabel);
      remove.addEventListener('click', () => {
        if (window.confirm(options.confirmDelete)) options.onDelete(node.id);
      });
      item.append(toggle, move, remove);
      list.append(item);
      if (!isCollapsed) appendChildren(node.id, childDepth, childVariation);
    });
  };

  appendChildren('root', 0, false);
  options.host.append(list);
}
