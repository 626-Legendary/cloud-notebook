import { Table } from "@tiptap/extension-table";
import { TableMap } from "@tiptap/pm/tables";
import { Plugin } from "@tiptap/pm/state";
import type { Transaction, EditorState } from "@tiptap/pm/state";

export const MAX_TABLE_COLUMNS = 20;
export function selectedTableWidth(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.spec.tableRole === "table") return TableMap.get(node).width;
  }
  const node = state.doc.nodeAt(state.selection.from);
  return node?.type.spec.tableRole === "table" ? TableMap.get(node).width : 0;
}
export const LimitedTable = Table.extend({
  addCommands() {
    const parent = this.parent?.();
    return {
      ...parent,
      insertTable: (options) => (props) => {
        const cols = options?.cols ?? 3;
        if (!Number.isInteger(cols) || cols < 1 || cols > MAX_TABLE_COLUMNS) return false;
        return parent?.insertTable?.(options)(props) ?? false;
      },
      addColumnBefore: () => (props) => selectedTableWidth(props.state) < MAX_TABLE_COLUMNS && (parent?.addColumnBefore?.()(props) ?? false),
      addColumnAfter: () => (props) => selectedTableWidth(props.state) < MAX_TABLE_COLUMNS && (parent?.addColumnAfter?.()(props) ?? false)
    };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), new Plugin({
      // Catch pasted tables and raw transactions as well as toolbar/shortcut commands.
      // Existing oversized legacy tables stay readable and editable, including deletion.
      filterTransaction: tableTransactionWithinLimit
    })];
  }
});

export function tableTransactionWithinLimit(transaction: Transaction, state: EditorState) {
  if (!transaction.docChanged) return true;
  let allowed = true;
  const inverse = transaction.mapping.invert();
  transaction.doc.descendants((node, position) => {
    if (node.type.spec.tableRole !== "table") return;
    try {
      const width = TableMap.get(node).width;
      if (width <= MAX_TABLE_COLUMNS) return;
      const oldNode = state.doc.nodeAt(inverse.map(position));
      if (!oldNode || oldNode.type.spec.tableRole !== "table" || TableMap.get(oldNode).width < width) allowed = false;
    } catch { allowed = false; }
  });
  return allowed;
}
