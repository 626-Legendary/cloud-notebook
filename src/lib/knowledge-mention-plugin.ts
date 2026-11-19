import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { canStartKnowledgeMention, knowledgeMentionAtSelection } from "@/lib/knowledge-trigger";

export type KnowledgeMention = { from: number; to: number; query: string };
export const knowledgeMentionKey = new PluginKey<KnowledgeMention | null>("knowledgeMention");

export function createKnowledgeMentionPlugin(onChange: (value: KnowledgeMention | null) => void, onKeyDown: (event: KeyboardEvent) => boolean) {
  let composing = false, destroyed = false;
  let session: { doc: Node; anchor: number; activeFrom?: number } | null = null;
  let dismissedFrom: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: KnowledgeMention | null = null;
  const publish = (view: EditorView) => {
    const next = composing ? null : knowledgeMentionKey.getState(view.state) ?? null;
    if (next?.from === previous?.from && next?.to === previous?.to && next?.query === previous?.query) return;
    previous = next; onChange(next);
  };
  return new Plugin<KnowledgeMention | null>({
    key: knowledgeMentionKey,
    state: {
      init: () => null,
      apply(tr, active, _old, state) {
        if (session) {
          session.anchor = tr.mapping.map(session.anchor, -1);
          if (session.activeFrom !== undefined) session.activeFrom = tr.mapping.map(session.activeFrom, -1);
        }
        if (dismissedFrom !== null) {
          dismissedFrom = tr.mapping.map(dismissedFrom, -1);
          if (dismissedFrom >= state.doc.content.size || state.doc.textBetween(dismissedFrom, dismissedFrom + 1) !== "@") dismissedFrom = null;
        }
        if (tr.getMeta(knowledgeMentionKey) === "close") { dismissedFrom = active?.from ?? dismissedFrom; return null; }
        const start = tr.getMeta(knowledgeMentionKey) as { from?: number } | undefined;
        if (!active && start?.from === undefined) return null;
        if (start?.from !== undefined) dismissedFrom = null;
        const from = start?.from ?? tr.mapping.map(active!.from, -1);
        const next = knowledgeMentionAtSelection(state);
        return next?.from === from ? next : null;
      }
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (composing || view.composing || !/^@[^\s@]*$/.test(text) || !canStartKnowledgeMention(view.state, from, to)) return false;
        view.dispatch(view.state.tr.insertText(text, from, to).setMeta(knowledgeMentionKey, { from })); return true;
      },
      handlePaste(view) {
        if (timer) clearTimeout(timer);
        session = null; composing = false;
        if (knowledgeMentionKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(knowledgeMentionKey, "close"));
        return false;
      },
      handleKeyDown(view, event) {
        if (composing || view.composing || event.isComposing || event.keyCode === 229 || !knowledgeMentionKey.getState(view.state)) return false;
        return onKeyDown(event);
      },
      handleDOMEvents: {
        compositionstart(view) {
          if (timer) clearTimeout(timer);
          if (dismissedFrom !== null && view.state.selection.from <= dismissedFrom && view.state.selection.to > dismissedFrom) dismissedFrom = null;
          composing = true;
          session = { doc: view.state.doc, anchor: view.state.selection.from, activeFrom: knowledgeMentionKey.getState(view.state)?.from };
          publish(view); return false;
        },
        compositionend(view) {
          if (timer) clearTimeout(timer);
          // The final DOM input/MutationObserver commit runs before this event-owned task.
          timer = setTimeout(() => {
            timer = undefined; composing = false;
            const completed = session; session = null;
            if (destroyed || !completed) return;
            const next = knowledgeMentionAtSelection(view.state);
            const changed = !completed.doc.eq(view.state.doc);
            const touched = next && (next.from === completed.activeFrom || changed && next.from >= completed.anchor - 1);
            if (touched && next.from !== dismissedFrom) view.dispatch(view.state.tr.setMeta(knowledgeMentionKey, { from: next.from }));
            else { view.dispatch(view.state.tr.setMeta(knowledgeMentionKey, "close")); }
          }, 0);
          return false;
        }
      }
    },
    view: (view) => {
      // ProseMirror recreates plugin views when another plugin is registered.
      destroyed = false;
      publish(view);
      return {
        update: publish,
        destroy() { destroyed = true; session = null; if (timer) clearTimeout(timer); }
      };
    }
  });
}
