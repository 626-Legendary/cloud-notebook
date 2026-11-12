"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { BubbleMenu } from "@tiptap/react/menus";
import { TextSelection, type SelectionBookmark, type Transaction } from "@tiptap/pm/state";
import { documentExtensions } from "@/lib/editor-extensions";
import { selectedTableWidth, MAX_TABLE_COLUMNS } from "@/lib/table-limit";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, AlertCircle, AlertTriangle,
  Bold, Eraser, CheckCircle2, ChevronRight, Clock3, Code2,
  Folder, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, LoaderCircle, NotebookPen,
  Minus, Palette, Quote, Redo2, Rows3, Columns3, Table2, Trash2, Strikethrough, Underline as UnderlineIcon,
  Undo2, FileDown, RotateCcw, Image as ImageIcon, Search, X, ChevronUp, ChevronDown
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "@/db/schema";
import { useConfirm } from "@/components/ui/alert-dialog";
import { useFormDialog } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fontFamilies, resolveFontFamily } from "@/lib/editor-formatting";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
import { ToastViewportAnchor } from "@/components/ui/toast-provider";
import { adjustSelectedFontSizes, fontSizeSteps, nextFontSize, parseFontSize, selectedFontSizeRange } from "@/lib/editor-font-size";
import { notify } from "@/lib/notifications";
import { parseMarkdownTable } from "@/lib/markdown-table";
import { findTextRanges } from "@/lib/prosemirror-search";
import { autoSaveDelay } from "@/lib/auto-save";
import { serializePageSave, registerPageFlush, waitForPageSaves } from "@/lib/page-save-queue";
import { breadcrumbTitle } from "@/lib/display-title";
import { WorkspaceLoading } from "@/components/workspace-loading";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
type PageData = Pick<Page, "id" | "title" | "content" | "version" | "updatedAt">;

// BubbleMenu dispatches an options transaction when these prop references change.
const bubbleMenuOptions = { placement: "top" as const, offset: 8 };
function shouldShowBubbleMenu({ editor }: { editor: TiptapEditor }) {
  const selection = editor.state.selection;
  return selection instanceof TextSelection && !selection.empty;
}
const textColors = [
  ["黑色", "#222222"], ["灰色", "#6B7280"], ["红色", "#DC2626"], ["橙色", "#EA580C"],
  ["琥珀", "#D97706"], ["黄色", "#CA8A04"], ["绿色", "#16A34A"], ["青色", "#0D9488"],
  ["蓝色", "#2563EB"], ["紫色", "#7C3AED"], ["粉色", "#DB2777"]
] as const;
const highlightColors = [
  ["黄色", "#FEF08A"], ["橙色", "#FED7AA"], ["红色", "#FECACA"], ["粉色", "#FBCFE8"],
  ["玫瑰", "#FDA4AF"], ["紫色", "#DDD6FE"], ["蓝色", "#BFDBFE"], ["青色", "#A5F3FC"],
  ["绿色", "#BBF7D0"], ["灰色", "#E5E7EB"]
] as const;

type FindPluginState = { query: string; decorations: DecorationSet };
const findPluginKey = new PluginKey<FindPluginState>("pageFind");
const pageFindExtension = Extension.create({
  name: "pageFind",
  addProseMirrorPlugins() {
    return [new Plugin<FindPluginState>({
      key: findPluginKey,
      state: {
        init: () => ({ query: "", decorations: DecorationSet.empty }),
        apply(transaction, state, _oldState, newState) {
          const query = transaction.getMeta(findPluginKey) as string | undefined;
          if (query !== undefined) return { query, decorations: createFindDecorations(newState.doc, query) };
          if (transaction.docChanged) return { query: state.query, decorations: createFindDecorations(newState.doc, state.query) };
          return { query: state.query, decorations: state.decorations.map(transaction.mapping, transaction.doc) };
        }
      },
      props: { decorations: (state) => findPluginKey.getState(state)?.decorations ?? DecorationSet.empty }
    })];
  }
});

function createFindDecorations(doc: ProseMirrorNode, query: string) {
  const ranges = findTextRanges(doc, query);
  return DecorationSet.create(doc, ranges.map(({ from, to }) => Decoration.inline(from, to, { class: "page-find-match" })));
}

export function PageEditor({
  page, autoSaveMode, breadcrumb, onNavigateFolder, onNavigateNotebook,
  onOpenSidebar, onOpenPages, onSaved, onStatus, onOpenHistory, onExport, onGlobalSearch
}: {
  page: PageData;
  autoSaveMode: string;
  breadcrumb: { folder: string; notebook: string; page: string };
  onNavigateFolder: () => void;
  onNavigateNotebook: () => void;
  onOpenSidebar: () => void;
  onOpenPages: () => void;
  onSaved: (page: PageData) => void;
  onStatus?: (status: SaveState) => void;
  onOpenHistory: () => void;
  onExport: () => void;
  onGlobalSearch: () => void;
}) {
  const confirm = useConfirm();
  const ask = useFormDialog();
  const [status, setStatus] = useState<SaveState>("saved");
  const [message, setMessage] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [customHex, setCustomHex] = useState("");
  const [customHighlightHex, setCustomHighlightHex] = useState("");
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<{ from: number; to: number }[]>([]);
  const [activeFindMatch, setActiveFindMatch] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const draftCheckedRef = useRef(false);
  const versionRef = useRef(page.version);
  const titleRef = useRef(page.title);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const editRevisionRef = useRef(0);
  const autoSaveModeRef = useRef(autoSaveMode);
  useEffect(() => { autoSaveModeRef.current = autoSaveMode; }, [autoSaveMode]);
  const savingRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const imageUploadBookmarksRef = useRef<Set<{ bookmark: SelectionBookmark }>>(new Set());
  const onSavedRef = useRef(onSaved);
  const onStatusRef = useRef(onStatus);
  const selectionRef = useRef<{ from: number; to: number; node: boolean }>({ from: 1, to: 1, node: false });
  const insertLinkRef = useRef<() => void>(() => {});
  const [selectionRevision, setSelectionRevision] = useState(0);
  useEffect(() => {
    onSavedRef.current = onSaved;
    onStatusRef.current = onStatus;
  }, [onSaved, onStatus]);

  const updateStatus = useCallback((next: SaveState) => {
    setStatus(next);
    onStatusRef.current?.(next);
  }, []);


  // Workspace keys this component by page ID and explicit restore revision.
  // Saving updates the page prop, but must not replace the live editor content.
  const [initialDocument] = useState(() => ({
    extensions: [...documentExtensions(), pageFindExtension],
    content: JSON.parse(page.content)
  }));
  const editor = useEditor({
    immediatelyRender: false,
    extensions: initialDocument.extensions,
    content: initialDocument.content,
    editorProps: {
      attributes: { class: "notebook-editor", "aria-label": "笔记正文" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((item) => item.type.startsWith("image/"));
        if (files.length) {
          event.preventDefault();
          void uploadImages(files);
          return true;
        }
        const markdown = event.clipboardData?.getData("text/markdown") || event.clipboardData?.getData("text/plain") || "";
        const tableRows = parseMarkdownTable(markdown);
        if (!tableRows) return false;
        event.preventDefault();
        return insertPastedTable(_view, tableRows);
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((item) => item.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        void uploadImages(files);
        return true;
      }
    },
    onUpdate: ({ editor: activeEditor }) => {
      editRevisionRef.current += 1;
      dirtyRef.current = true;
      if (!conflictRef.current) updateStatus("dirty");
      const key = `cloud-notebook-draft:${page.id}`;
      localStorage.setItem(key, JSON.stringify({
        version: versionRef.current, title: titleRef.current, content: activeEditor.getJSON(), updatedAt: new Date().toISOString()
      }));
      scheduleSave();
    }
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    const title = titleInputRef.current;
    if (!title) return;
    resizeTitle(title);
    let width = title.clientWidth;
    const observer = new ResizeObserver(() => {
      if (title.clientWidth === width) return;
      width = title.clientWidth;
      resizeTitle(title);
    });
    observer.observe(title);
    return () => observer.disconnect();
  }, [editor, page.id, page.title]);
  useEffect(() => {
    if (!editor) return;
    const mapUploadBookmarks = ({ transaction }: { transaction: { mapping: Parameters<SelectionBookmark["map"]>[0] } }) => {
      for (const item of imageUploadBookmarksRef.current) {
        item.bookmark = item.bookmark.map(transaction.mapping);
      }
    };
    const syncSelection = () => {
      const selection = editor.state.selection;
      selectionRef.current = { from: selection.from, to: selection.to, node: "node" in selection };
      setSelectionRevision((revision) => revision + 1);
    };
    const captureSelection = ({ transaction }: { transaction: Transaction }) => {
      // Plugin metadata alone does not change the toolbar's document/selection state.
      if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet) syncSelection();
    };
    editor.on("transaction", mapUploadBookmarks);
    editor.on("transaction", captureSelection);
    syncSelection();
    return () => {
      editor.off("transaction", mapUploadBookmarks);
      editor.off("transaction", captureSelection);
    };
  }, [editor]);

  const save = useCallback(async function persist(preserveCurrentVersion = false) {
    const activeEditor = editorRef.current;
    if (!activeEditor || !dirtyRef.current) return;
    if (conflictRef.current && !preserveCurrentVersion) return;
    if (savingRef.current) {
      saveAgainRef.current = true;
      return savingRef.current;
    }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const operation = serializePageSave(page.id, async () => {
      const editRevision = editRevisionRef.current;
      const body = {
        title: titleRef.current.trim() || "无标题",
        content: activeEditor.getJSON(),
        version: versionRef.current,
        ...(preserveCurrentVersion ? { preserveCurrentVersion: true } : {})
      };
      updateStatus("saving");
      setMessage("");
      try {
        const response = await fetch(`/api/pages/${page.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        });
        const result = await response.json();
        if (response.status === 409) {
          conflictRef.current = true;
          updateStatus("conflict");
          setConflictDismissed(false);
          setMessage(result.error ?? "此页面已在其他位置更新，请先解决版本冲突");
          notify.warning(result.error ?? "此页面已在其他位置更新，请先解决版本冲突", `page-conflict:${page.id}`);
          return;
        }
        if (!response.ok) throw new Error(result.error ?? "保存失败，请稍后重试");
        versionRef.current = result.page.version;
        conflictRef.current = false;
        onSavedRef.current(result.page);
        if (editRevisionRef.current === editRevision) {
          dirtyRef.current = false;
          localStorage.removeItem(`cloud-notebook-draft:${page.id}`);
          updateStatus("saved");
        } else {
          dirtyRef.current = true;
          localStorage.setItem(`cloud-notebook-draft:${page.id}`, JSON.stringify({
            version: versionRef.current, title: titleRef.current, content: activeEditor.getJSON(), updatedAt: new Date().toISOString()
          }));
          updateStatus("dirty");
          if (timerRef.current) clearTimeout(timerRef.current);
          const delay = autoSaveDelay(autoSaveModeRef.current);
          if (delay !== null) timerRef.current = setTimeout(() => { timerRef.current = null; void persist(); }, delay);
        }
      } catch (error) {
        updateStatus("error");
        const message = error instanceof Error ? error.message : "保存失败，请检查网络连接";
        setMessage(message);
        notify.error(message, `page-save:${page.id}`);
      }
    });
    savingRef.current = operation;
    try { await operation; }
    finally {
      savingRef.current = null;
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        if (dirtyRef.current && !conflictRef.current) await persist();
      }
    }
  }, [page.id, updateStatus]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => registerPageFlush(page.id, async () => {
    await saveRef.current();
    await waitForPageSaves(page.id);
    if (dirtyRef.current || conflictRef.current) throw new Error("请先保存或解决当前页面的版本冲突");
  }), [page.id]);
  useEffect(() => {
    if (!editor) return;
    const refreshMatches = () => {
      const matches = findTextRanges(editor.state.doc, findQuery);
      setFindMatches((current) => current.length === matches.length &&
        current.every((item, index) => item.from === matches[index]?.from && item.to === matches[index]?.to)
        ? current : matches);
    };
    editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, findQuery));
    refreshMatches();
    editor.on("transaction", refreshMatches);
    return () => { editor.off("transaction", refreshMatches); };
  }, [editor, findQuery]);

  function navigateFindMatch(direction: 1 | -1) {
    if (!editor || !findMatches.length) return;
    const next = (activeFindMatch + direction + findMatches.length) % findMatches.length;
    setActiveFindMatch(next);
    editor.commands.setTextSelection(findMatches[next]);
    editor.commands.scrollIntoView();
    findInputRef.current?.focus();
  }

  function closePageFind() {
    setFindOpen(false);
    setFindQuery("");
    setActiveFindMatch(0);
    findInputRef.current?.blur();
    editor?.commands.focus();
  }

  const scheduleSave = useCallback(() => {
    if (timerRef.current || conflictRef.current) return;
    const delay = autoSaveDelay(autoSaveMode);
    if (delay === null) return;
    timerRef.current = setTimeout(() => { timerRef.current = null; void saveRef.current(); }, delay);
  }, [autoSaveMode]);
  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (dirtyRef.current) scheduleSave();
  }, [scheduleSave]);
  useEffect(() => {
    if (!editor || draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    const savedDraft = localStorage.getItem(`cloud-notebook-draft:${page.id}`);
    if (savedDraft && editor) {
      try {
        const draft = JSON.parse(savedDraft) as { version?: number; title?: string; content?: unknown };
        if (draft.version === versionRef.current && draft.content) {
          void confirm("发现尚未保存的本地草稿，是否恢复？", "恢复草稿").then((accepted) => {
            if (!accepted) return;
            editor.commands.setContent(draft.content as never);
            if (draft.title) {
              titleRef.current = draft.title;
              if (titleInputRef.current) titleInputRef.current.value = draft.title;
            }
            dirtyRef.current = true;
            setTimeout(() => updateStatus("dirty"), 0);
            scheduleSave();
          });
        }
      } catch (error) {
        console.error("Unable to restore local editor draft", error);
        localStorage.removeItem(`cloud-notebook-draft:${page.id}`);
      }
    }
  }, [confirm, editor, page.id, scheduleSave, updateStatus]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (matchesShortcut(event, "s")) {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      const scoped = editorRef.current?.isFocused || target?.closest(".toolbar-wrapper, .page-find-bar");
      if (!scoped || target?.closest(".format-popover")) return;
      if (matchesShortcut(event, "f")) {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (matchesShortcut(event, "k") && !target?.closest("input, textarea, select")) {
        event.preventDefault();
        const activeEditor = editorRef.current;
        if (activeEditor) selectionRef.current = {
          from: activeEditor.state.selection.from,
          to: activeEditor.state.selection.to,
          node: "node" in activeEditor.state.selection
        };
        insertLinkRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (dirtyRef.current) void saveRef.current();
  }, []);

  async function uploadImages(files: File[]) {
    const activeEditor = editorRef.current;
    if (!activeEditor) return;
    setImageBusy(true);
    setMessage("");
    try {
      for (const file of files) {
        const uploadBookmark = { bookmark: activeEditor.state.selection.getBookmark() };
        imageUploadBookmarksRef.current.add(uploadBookmark);
        const data = new FormData();
        data.append("file", file);
        try {
          const response = await fetch("/api/assets/upload", { method: "POST", body: data });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "图片上传失败");
          const currentEditor = editorRef.current;
          if (!currentEditor) return;
          const selection = uploadBookmark.bookmark.resolve(currentEditor.state.doc);
          const imageNode = currentEditor.schema.nodes.image.create({
            src: result.asset.url, alt: file.name, assetId: result.asset.id
          });
          const transaction = currentEditor.state.tr.setSelection(selection).replaceSelectionWith(imageNode);
          const imageEnd = transaction.mapping.map(selection.from, 1);
          let cursorPosition = imageEnd;
          const $imageEnd = transaction.doc.resolve(imageEnd);
          if ($imageEnd.nodeAfter?.type.name !== "paragraph") {
            transaction.insert(imageEnd, currentEditor.schema.nodes.paragraph.create());
            cursorPosition += 1;
          }
          transaction.setSelection(TextSelection.near(transaction.doc.resolve(cursorPosition), 1));
          currentEditor.view.dispatch(transaction);
          currentEditor.commands.focus();
        } finally {
          imageUploadBookmarksRef.current.delete(uploadBookmark);
        }
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setImageBusy(false);
    }
  }

  function changeTitle(value: string) {
    titleRef.current = value;
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    if (!conflictRef.current) updateStatus("dirty");
    const content = editorRef.current?.getJSON();
    if (content) localStorage.setItem(`cloud-notebook-draft:${page.id}`, JSON.stringify({
      version: versionRef.current, title: value, content, updatedAt: new Date().toISOString()
    }));
    scheduleSave();
  }

  function resizeTitle(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }

  function rememberSelection() {
    if (!editor) return;
    const { selection } = editor.state;
    selectionRef.current = { from: selection.from, to: selection.to, node: "node" in selection };
  }

  function preserveSelection(event: React.MouseEvent) {
    rememberSelection();
    event.preventDefault();
  }

  function applyAtSelection(action: (activeEditor: TiptapEditor) => void) {
    if (!editor) return;
    const { from, to, node } = selectionRef.current;
    try {
      if (node) editor.commands.setNodeSelection(from);
      else editor.commands.setTextSelection({ from, to });
    } catch {
      editor.commands.focus();
    }
    action(editor);
    editor.commands.focus();
  }

  function applyFontSize(value: string) {
    const size = parseFontSize(value);
    if (size === null) {
      notify.error("字号必须在 8–96 px 之间");
      return;
    }
    applyAtSelection((activeEditor) => activeEditor.commands.setFontSize(`${size}px`));
  }

  function applyHexColor(value: string) {
    if (!/^#[\da-f]{6}$/i.test(value)) {
      notify.error("请输入有效的 HEX 颜色，例如 #2563EB");
      return;
    }
    applyAtSelection((activeEditor) => activeEditor.commands.setColor(value));
    setMessage("");
  }

  function applyHighlightColor(value: string) {
    if (!/^#[\da-f]{6}$/i.test(value)) {
      notify.error("请输入有效的 HEX 高亮颜色，例如 #FEF08A");
      return;
    }
    applyAtSelection((activeEditor) => activeEditor.chain().setHighlight({ color: value }).run());
  }

  function adjustFontSize(direction: -1 | 1) {
    if (!editor) return;
    applyAtSelection((activeEditor) => { adjustSelectedFontSizes(activeEditor, direction); });
  }

  function colorPickerValue(value: string) {
    if (/^#[\da-f]{6}$/i.test(value)) return value;
    const shortHex = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value);
    return shortHex ? `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}` : "#222222";
  }

  async function insertLink() {
    const input = await ask({ title: "插入链接", submitLabel: "应用链接", fields: [{ name: "href", label: "链接地址", placeholder: "https://example.com", maxLength: 2048 }] });
    const href = input?.values.href.trim();
    if (!href || !/^(https?:\/\/|mailto:)/i.test(href)) {
      if (href) notify.error("请输入以 http://、https:// 或 mailto: 开头的链接");
      return;
    }
    applyAtSelection((activeEditor) => activeEditor.chain().extendMarkRange("link").setLink({ href }).run());
  }
  useEffect(() => {
    insertLinkRef.current = () => { void insertLink(); };
  });

  async function overwriteLocalVersion() {
    if (!await confirm("这会用当前本地内容替换服务器版本。覆盖前会自动保存服务器当前版本的历史快照。继续吗？", "覆盖服务器版本")) return;
    try {
      await savingRef.current;
      const latest = await fetch(`/api/pages/${page.id}`);
      const result = await latest.json();
      if (!latest.ok) throw new Error(result.error ?? "无法读取服务器版本");
      versionRef.current = result.page.version;
      dirtyRef.current = true;
      await saveRef.current(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "无法覆盖服务器版本";
      setMessage(message);
      notify.error(message, `page-overwrite:${page.id}`);
    }
  }

  async function loadServerVersion() {
    if (!await confirm("加载服务器版本会替换本地未保存内容。继续前请确认本地草稿不再需要。", "加载服务器版本")) return;
    try {
      await savingRef.current;
      const latest = await fetch(`/api/pages/${page.id}`);
      const result = await latest.json();
      if (!latest.ok) throw new Error(result.error ?? "无法读取服务器版本");
      versionRef.current = result.page.version;
      titleRef.current = result.page.title;
      if (titleInputRef.current) titleInputRef.current.value = result.page.title;
      editor?.commands.setContent(JSON.parse(result.page.content), { emitUpdate: false });
      editRevisionRef.current += 1;
      dirtyRef.current = false;
      conflictRef.current = false;
      localStorage.removeItem(`cloud-notebook-draft:${page.id}`);
      updateStatus("saved");
      onSavedRef.current(result.page);
      setMessage("");
      setConflictDismissed(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "无法加载服务器版本";
      setMessage(message);
      notify.error(message, `page-load-server:${page.id}`);
    }
  }

  const selectedFontSize = editor ? selectedMarkAttribute(editor, "fontSize") : "";
  const fontSizeRange = editor ? selectedFontSizeRange(editor.state) : { minimum: 16, maximum: 16 };
  const currentHighlightColor = editor?.getAttributes("highlight").color as string | undefined;
  const selectedFontFamily = editor ? resolveFontFamily(selectedMarkAttribute(editor, "fontFamily")) : "";
  const selectedTextColor = editor ? selectedMarkAttribute(editor, "color") : "";
  const selectedTextAlign = editor?.getAttributes("textAlign").textAlign ?? "left";
  const imageAttributes = editor?.getAttributes("image") as { alignment?: string; displayWidth?: number } | undefined;
  const imageSelected = Boolean(editor?.isActive("image"));
  void selectionRevision;

  if (!editor) return <WorkspaceLoading />;

  return (
    <div className="editor-panel">
      <header className="editor-topbar">
        <div className="editor-topbar-navigation-row">
          <div className="editor-navigation">
        <button className="icon-button mobile-nav-toggle" type="button" title="显示文件夹" aria-label="显示文件夹" onClick={onOpenSidebar}><Folder size={16} /></button>
        <button className="icon-button mobile-nav-toggle" type="button" title="显示页面列表" aria-label="显示页面列表" onClick={onOpenPages}><NotebookPen size={16} /></button>
        <nav className="breadcrumbs" aria-label="页面路径">
          <button type="button" title={breadcrumb.folder} onClick={onNavigateFolder}>{breadcrumbTitle(breadcrumb.folder)}</button>
          <ChevronRight size={14} aria-hidden="true" />
          <button type="button" title={breadcrumb.notebook} onClick={onNavigateNotebook}>{breadcrumbTitle(breadcrumb.notebook)}</button>
          <ChevronRight size={14} aria-hidden="true" />
          <span title={breadcrumb.page} aria-current="page">{breadcrumbTitle(breadcrumb.page)}</span>
        </nav>
          </div>
        <div className="editor-actions">
          <span className={`save-state save-${status}`} role="status">
            {status === "saved" ? <CheckCircle2 size={15} /> : null}
            {status === "saving" ? <LoaderCircle size={15} className="spin" /> : null}
            {status === "dirty" ? <Clock3 size={15} /> : null}
            {status === "conflict" ? <AlertTriangle size={15} /> : null}
            {status === "error" ? <AlertCircle size={15} /> : null}
            {status === "saved" ? "已保存" : status === "saving" ? "正在保存..." : status === "dirty" ? "尚未保存" : status === "conflict" ? "版本冲突" : "保存失败"}
          </span>
          {autoSaveMode === "off" && <button className="button-subtle" onClick={() => void saveRef.current()}>保存</button>}
          {status === "error" && <button className="button-subtle" onClick={() => void saveRef.current()}>重试</button>}
          {status === "conflict" && <button className="button-subtle" onClick={() => setConflictDismissed(false)}>处理冲突</button>}
          <button className="button-subtle header-action" title="版本历史" onClick={onOpenHistory}><Clock3 size={15} /><span className="header-action-label">历史</span></button>
          <button className="button-subtle header-action" title="导出 / 打印" onClick={onExport}><FileDown size={15} /><span className="header-action-label">导出</span></button>
          <button className="button-subtle header-action" title="全局搜索 (Ctrl/Cmd+Shift+F)" onClick={onGlobalSearch}><Search size={15} /><span className="header-action-label">搜索</span></button>
        </div>
        </div>
      </header>
      <div className="toolbar-wrapper" role="toolbar" aria-label="文档格式工具">
        <div className="toolbar-row formatting-toolbar">
          <div className="toolbar-formatting">
          <div className="toolbar-group" aria-label="历史记录">
            <button className="toolbar-button" aria-label="撤销" title="撤销" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().undo().run())}><Undo2 size={16} /></button>
            <button className="toolbar-button" aria-label="重做" title="重做" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().redo().run())}><Redo2 size={16} /></button>
          </div>
          <span className="toolbar-divider" />
          <div className="toolbar-group" aria-label="文字样式">
            <select aria-label="标题样式" title="段落样式" value={editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p"} onPointerDown={rememberSelection} onChange={(event) => applyAtSelection((active) => event.target.value === "h1" ? active.chain().toggleHeading({ level: 1 }).run() : event.target.value === "h2" ? active.chain().toggleHeading({ level: 2 }).run() : event.target.value === "h3" ? active.chain().toggleHeading({ level: 3 }).run() : active.chain().setParagraph().run())}>
              <option value="p">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option>
            </select>
            <span className="toolbar-divider" role="separator" aria-orientation="vertical" />
            <div className="toolbar-group font-size-controls" aria-label="字号调整">
            <button className="font-size-step-button" type="button" aria-label="减小字号" title="减小字号" disabled={nextFontSize(fontSizeRange.maximum, -1) === null} onMouseDown={preserveSelection} onClick={() => adjustFontSize(-1)}>A−</button>
            <select aria-label="字号" title="文字字号" value={selectedFontSize || ""} onPointerDown={rememberSelection} onChange={(event) => applyFontSize(event.target.value)}>
              <option value="">字号</option>{selectedFontSize === "mixed" && <option value="mixed">混合字号</option>}
              {fontSizeSteps.map((size) => <option key={size} value={`${size}px`}>{size} px</option>)}
              {selectedFontSize && selectedFontSize !== "mixed" && !fontSizeSteps.some((size) => `${size}px` === selectedFontSize) && <option value={selectedFontSize}>{selectedFontSize}</option>}
            </select>
            <button className="font-size-step-button" type="button" aria-label="增大字号" title="增大字号" disabled={nextFontSize(fontSizeRange.minimum, 1) === null} onMouseDown={preserveSelection} onClick={() => adjustFontSize(1)}>A+</button>
            </div>
            <span className="toolbar-divider" role="separator" aria-orientation="vertical" />
            <Popover>
              <PopoverTrigger asChild><button className="toolbar-button" type="button" aria-label="自定义字号" title="自定义字号" onMouseDown={preserveSelection}><span className="toolbar-text-icon">A</span></button></PopoverTrigger>
              <PopoverContent className="format-popover">
                <label className="format-field">自定义字号（8–96 px）<input className="control-input" type="number" min={8} max={96} defaultValue={selectedFontSize && selectedFontSize !== "mixed" ? Number.parseInt(selectedFontSize, 10) : 16} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyFontSize((event.currentTarget as HTMLInputElement).value); } }} /></label>
                <button className="button-outline" type="button" onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector("input"); if (input) applyFontSize(input.value); }}>应用字号</button>
                <button className="button-subtle" type="button" onClick={() => applyAtSelection((active) => active.commands.unsetFontSize())}><RotateCcw size={13} />重置字号</button>
              </PopoverContent>
            </Popover>
            <span className="toolbar-divider" role="separator" aria-orientation="vertical" />
            <select aria-label="字体" title="字体" value={selectedFontFamily === "mixed" ? "mixed" : selectedFontFamily} onPointerDown={rememberSelection} onChange={(event) => applyAtSelection((active) => event.target.value ? active.commands.setFontFamily(event.target.value) : active.commands.unsetFontFamily())}>
              {selectedFontFamily === "mixed" && <option value="mixed">混合字体</option>}
              <option value="">默认字体</option>
              {(["zh", "en"] as const).map((type) => <optgroup key={type} label={type === "zh" ? "中文字体" : "English Fonts"}>{fontFamilies.filter((font) => font.type === type).map((font) => <option key={font.id} value={font.value} style={{ fontFamily: font.value }}>{font.label}</option>)}</optgroup>)}
            </select>
          </div>
          <span className="toolbar-divider" />
          <div className="toolbar-group" aria-label="文字格式">
            <button className={`toolbar-button ${editor.isActive("bold") ? "active" : ""}`} aria-label="加粗" aria-pressed={editor.isActive("bold")} title="加粗 (Ctrl/Cmd+B)" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleBold().run())}><Bold size={16} /></button>
            <button className={`toolbar-button ${editor.isActive("italic") ? "active" : ""}`} aria-label="斜体" aria-pressed={editor.isActive("italic")} title="斜体 (Ctrl/Cmd+I)" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleItalic().run())}><Italic size={16} /></button>
            <button className={`toolbar-button ${editor.isActive("underline") ? "active" : ""}`} aria-label="下划线" aria-pressed={editor.isActive("underline")} title="下划线 (Ctrl/Cmd+U)" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleUnderline().run())}><UnderlineIcon size={16} /></button>
            <button className={`toolbar-button ${editor.isActive("strike") ? "active" : ""}`} aria-label="删除线" aria-pressed={editor.isActive("strike")} title="删除线" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleStrike().run())}><Strikethrough size={16} /></button>
          </div>
          <span className="toolbar-divider" />
          <div className="toolbar-group" aria-label="文字颜色与高亮">
            <Popover>
              <PopoverTrigger asChild><button className="toolbar-button" type="button" aria-label="文字颜色" title="文字颜色" onMouseDown={preserveSelection}><Palette size={16} /><span className="color-indicator" style={{ background: selectedTextColor && selectedTextColor !== "mixed" ? selectedTextColor : "#222222" }} /></button></PopoverTrigger>
              <PopoverContent className="format-popover color-popover">
                <strong>文字颜色</strong><div className="color-grid">{textColors.map(([label, color]) => <button key={color} type="button" className={`color-swatch ${selectedTextColor === color ? "selected" : ""}`} style={{ backgroundColor: color }} title={label} aria-label={label} onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.setColor(color))} />)}</div>
                <label className="format-field">自定义颜色<input className="control-input" type="color" value={colorPickerValue(selectedTextColor)} onPointerDown={rememberSelection} onChange={(event) => applyAtSelection((active) => active.commands.setColor(event.target.value))} /></label>
                <label className="format-field">HEX<input className="control-input" type="text" maxLength={7} placeholder="#222222" value={customHex} onPointerDown={rememberSelection} onChange={(event) => setCustomHex(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyHexColor(customHex); } }} /></label>
                <button className="button-outline" type="button" onMouseDown={preserveSelection} onClick={() => applyHexColor(customHex)}>应用颜色</button>
                <button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.unsetColor())}><RotateCcw size={13} />重置颜色</button>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild><button className={`toolbar-button ${editor.isActive("highlight") ? "active" : ""}`} aria-label="高亮颜色" aria-pressed={editor.isActive("highlight")} title="高亮颜色" onMouseDown={preserveSelection}><Highlighter size={16} /><span className="color-indicator" style={{ background: currentHighlightColor ?? "#FEF08A" }} /></button></PopoverTrigger>
              <PopoverContent className="format-popover highlight-popover">
                <strong>高亮颜色</strong>
                <div className="color-grid highlight-color-grid">{highlightColors.map(([label, color]) => <button
                  key={color}
                  type="button"
                  className={`color-swatch ${currentHighlightColor?.toUpperCase() === color ? "selected" : ""}`}
                  style={{ backgroundColor: color }}
                  title={label}
                  aria-label={label}
                  aria-pressed={currentHighlightColor?.toUpperCase() === color}
                  onMouseDown={preserveSelection}
                  onClick={() => applyHighlightColor(color)}
                />)}</div>
                <label className="format-field">自定义颜色<input className="control-input" type="color" value={colorPickerValue(currentHighlightColor ?? "#FEF08A")} onPointerDown={rememberSelection} onChange={(event) => applyHighlightColor(event.target.value)} /></label>
                <label className="format-field">HEX<input className="control-input" type="text" maxLength={7} placeholder="#FEF08A" value={customHighlightHex} onPointerDown={rememberSelection} onChange={(event) => setCustomHighlightHex(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyHighlightColor(customHighlightHex); } }} /></label>
                <button className="button-outline" type="button" onMouseDown={preserveSelection} onClick={() => applyHighlightColor(customHighlightHex)}>应用自定义颜色</button>
                <button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().unsetHighlight().run())}><RotateCcw size={13} />移除高亮</button>
              </PopoverContent>
            </Popover>
          </div>
          <span className="toolbar-divider" />
          <div className="toolbar-group" aria-label="段落格式">
            <button className={`toolbar-button ${editor.isActive("bulletList") ? "active" : ""}`} aria-label="项目列表" aria-pressed={editor.isActive("bulletList")} title="项目列表" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleBulletList().run())}><List size={16} /></button>
            <button className={`toolbar-button ${editor.isActive("orderedList") ? "active" : ""}`} aria-label="编号列表" aria-pressed={editor.isActive("orderedList")} title="编号列表" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleOrderedList().run())}><ListOrdered size={16} /></button>
            <button className={`toolbar-button ${selectedTextAlign === "left" ? "active" : ""}`} aria-label="左对齐" title="左对齐" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().setTextAlign("left").run())}><AlignLeft size={16} /></button>
            <button className={`toolbar-button ${selectedTextAlign === "center" ? "active" : ""}`} aria-label="居中对齐" title="居中对齐" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().setTextAlign("center").run())}><AlignCenter size={16} /></button>
            <button className={`toolbar-button ${selectedTextAlign === "right" ? "active" : ""}`} aria-label="右对齐" title="右对齐" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().setTextAlign("right").run())}><AlignRight size={16} /></button>
            <button className={`toolbar-button ${selectedTextAlign === "justify" ? "active" : ""}`} aria-label="两端对齐" title="两端对齐" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().setTextAlign("justify").run())}><AlignJustify size={16} /></button>
          </div>
          <span className="toolbar-divider" />
          <div className="toolbar-group" aria-label="插入内容">
            <button className={`toolbar-button ${editor.isActive("blockquote") ? "active" : ""}`} aria-label="引用" title="引用" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleBlockquote().run())}><Quote size={16} /></button>
            <button className={`toolbar-button ${editor.isActive("codeBlock") ? "active" : ""}`} aria-label="代码块" title="代码块" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleCodeBlock().run())}><Code2 size={16} /></button>
            <button className="toolbar-button" aria-label="分隔线" title="分隔线" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().setHorizontalRule().run())}><Minus size={16} /></button>
            <button className="toolbar-button" aria-label="插入链接" title="插入链接 (Ctrl/Cmd+K)" aria-keyshortcuts="Control+k Meta+k" onMouseDown={preserveSelection} onClick={() => void insertLink()}><Link2 size={16} /></button>
            <Popover>
              <PopoverTrigger asChild><button className="toolbar-button" aria-label="插入表格" title="插入表格" onMouseDown={preserveSelection}><Table2 size={16} /></button></PopoverTrigger>
              <PopoverContent className="format-popover table-insert-popover">
                <label>行数 <input type="number" min={1} max={20} value={tableRows} onPointerDown={rememberSelection} onChange={(event) => setTableRows(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
                <label>列数 <input type="number" min={1} max={20} value={tableColumns} onPointerDown={rememberSelection} onChange={(event) => setTableColumns(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
                <button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().insertTable({ rows: tableRows, cols: tableColumns, withHeaderRow: true }).run())}>插入 {tableRows} × {tableColumns}</button>
              </PopoverContent>
            </Popover>
            <label className="toolbar-button" title="插入图片" aria-label="插入图片"><ImagePlus size={16} /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadImages([file]);
              event.target.value = "";
            }} /></label>
          </div>
          <span className="toolbar-divider" />
          {editor.isActive("table") && <>
            <div className="toolbar-group" aria-label="表格操作">
              <button className="toolbar-button" aria-label="上方插入行" title="上方插入行" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().addRowBefore().run())}><Rows3 size={16} /></button>
              <button className="toolbar-button" aria-label="删除行" title="删除行" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().deleteRow().run())}><Trash2 size={15} /></button>
              <button className="toolbar-button" aria-label="右侧插入列" title="右侧插入列" disabled={selectedTableWidth(editor.state) >= MAX_TABLE_COLUMNS} onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().addColumnAfter().run())}><Columns3 size={16} /></button>
              <button className="toolbar-button" aria-label="删除列" title="删除列" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().deleteColumn().run())}><Trash2 size={15} /></button>
              <button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleHeaderRow().run())}>切换表头</button>
              <button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().deleteTable().run())}>删除表格</button>
            </div>
            <span className="toolbar-divider" />
          </>}
          </div>
          <div className="toolbar-search">
          <Popover open={findOpen} onOpenChange={(open) => { if (open) setFindOpen(true); else closePageFind(); }}>
            <PopoverTrigger asChild><button className={`toolbar-button ${findOpen ? "active" : ""}`} type="button" aria-label="搜索当前页面" title="搜索当前页面 (Ctrl/Cmd+F)" aria-keyshortcuts="Control+f Meta+f"><Search size={16} /></button></PopoverTrigger>
              <PopoverContent side="bottom" align="end" className="page-find-bar" onOpenAutoFocus={(event) => { event.preventDefault(); findInputRef.current?.focus(); }}>
          <input
            ref={findInputRef}
            type="search"
            value={findQuery}
            placeholder="搜索当前页面..."
            aria-label="搜索当前页面正文"
            onChange={(event) => { setFindQuery(event.target.value); setActiveFindMatch(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); closePageFind(); }
              if (event.key === "Enter") { event.preventDefault(); navigateFindMatch(event.shiftKey ? -1 : 1); }
            }}
          />
          <span className="page-find-count">{findMatches.length ? `${Math.min(activeFindMatch + 1, findMatches.length)} / ${findMatches.length}` : "0 / 0"}</span>
          <button className="icon-button" type="button" title="上一个匹配项" aria-label="上一个匹配项" disabled={!findMatches.length} onClick={() => navigateFindMatch(-1)}><ChevronUp size={16} /></button>
          <button className="icon-button" type="button" title="下一个匹配项" aria-label="下一个匹配项" disabled={!findMatches.length} onClick={() => navigateFindMatch(1)}><ChevronDown size={16} /></button>
          {findQuery && <button className="icon-button" type="button" title="清除搜索" aria-label="清除搜索" onClick={() => { setFindQuery(""); setActiveFindMatch(0); findInputRef.current?.focus(); }}><Eraser size={15} /></button>}
          <button className="icon-button" type="button" title="关闭搜索" aria-label="关闭搜索" onClick={closePageFind}><X size={15} /></button>
              </PopoverContent>
          </Popover>
          </div>
        </div>
        {imageSelected && <div className="toolbar-row image-toolbar" aria-label="图片布局">
          <span><ImageIcon size={14} />图片布局</span>
          {(["left", "center", "right"] as const).map((alignment) => <button key={alignment} className={`toolbar-button ${imageAttributes?.alignment === alignment ? "active" : ""}`} aria-label={`图片${alignment === "left" ? "左" : alignment === "center" ? "居中" : "右"}对齐`} title={`图片${alignment === "left" ? "左" : alignment === "center" ? "居中" : "右"}对齐`} onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.updateAttributes("image", { alignment }))}>{alignment === "left" ? <AlignLeft size={16} /> : alignment === "center" ? <AlignCenter size={16} /> : <AlignRight size={16} />}</button>)}
          <label className="image-width-control">宽度 <input aria-label="图片宽度" type="range" min="20" max="100" step="5" value={imageAttributes?.displayWidth ?? 100} onPointerDown={rememberSelection} onChange={(event) => applyAtSelection((active) => active.commands.updateAttributes("image", { displayWidth: Number(event.target.value) }))} /> {imageAttributes?.displayWidth ?? 100}%</label>
          <button className="button-subtle" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.updateAttributes("image", { alignment: "left", displayWidth: 100 }))}>重置</button>
        </div>}
      </div>
      {message && status !== "conflict" && <div className="editor-inline-error" role="alert">{message}</div>}
      {status === "conflict" && !conflictDismissed && <section className="conflict-toast" role="alertdialog" aria-labelledby="conflict-title" aria-describedby="conflict-description">
        <div className="conflict-toast-heading"><AlertTriangle size={19} /><strong id="conflict-title">检测到版本冲突</strong><button className="icon-button" type="button" aria-label="收起冲突提示" title="稍后处理" onClick={() => setConflictDismissed(true)}><X size={15} /></button></div>
        <p id="conflict-description">此页面已在其他位置更新。你的本地内容仍保留，请选择要保留的版本。</p>
        <div className="conflict-toast-actions">
          <button className="button-outline" type="button" onClick={() => void loadServerVersion()}>加载服务器版本</button>
          <button className="button-primary" type="button" onClick={() => void overwriteLocalVersion()}>保留本地并覆盖</button>
        </div>
      </section>}
      <div className="editor-scroll">
        <ToastViewportAnchor />
        <div className="editor-content-wrap">
          <textarea ref={titleInputRef} rows={1} maxLength={200} className="title-input" placeholder="无标题笔记" defaultValue={page.title} onChange={(event) => { resizeTitle(event.currentTarget); changeTitle(event.target.value); }} onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              editor.commands.focus();
            }
          }} aria-label="页面标题" />
          <EditorContent editor={editor} />
          {imageBusy && <div className="status-line">正在上传图片...</div>}
        </div>
      </div>
      {<BubbleMenu editor={editor} shouldShow={shouldShowBubbleMenu} options={bubbleMenuOptions}>
        <div className="bubble-menu">
          <button className={editor.isActive("bold") ? "active" : ""} aria-label="加粗" title="加粗" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleBold().run())}><Bold size={15} /></button>
          <button className={editor.isActive("italic") ? "active" : ""} aria-label="斜体" title="斜体" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleItalic().run())}><Italic size={15} /></button>
          <button className={editor.isActive("underline") ? "active" : ""} aria-label="下划线" title="下划线" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().toggleUnderline().run())}><UnderlineIcon size={15} /></button>
          <button aria-label="链接" title="插入链接" onMouseDown={preserveSelection} onClick={() => void insertLink()}><Link2 size={15} /></button>
          <button aria-label="选中文字减小字号" title="减小字号" onMouseDown={preserveSelection} onClick={() => adjustFontSize(-1)}>A−</button>
          <button aria-label="选中文字增大字号" title="增大字号" onMouseDown={preserveSelection} onClick={() => adjustFontSize(1)}>A+</button>
          <Popover>
            <PopoverTrigger asChild><button aria-label="文字颜色" title="文字颜色" onMouseDown={preserveSelection}><Palette size={15} /></button></PopoverTrigger>
            <PopoverContent className="format-popover color-popover">
              <div className="color-grid">{textColors.map(([label, color]) => <button key={color} type="button" className={`color-swatch ${selectedTextColor === color ? "selected" : ""}`} style={{ backgroundColor: color }} title={label} aria-label={label} onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.setColor(color))} />)}</div>
              <button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.unsetColor())}><RotateCcw size={13} />重置颜色</button>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild><button aria-label="文字高亮" title="文字高亮" onMouseDown={preserveSelection}><Highlighter size={15} /></button></PopoverTrigger>
            <PopoverContent className="format-popover color-popover">
              <div className="color-grid">{highlightColors.map(([label, color]) => <button key={color} type="button" className={`color-swatch ${currentHighlightColor === color ? "selected" : ""}`} style={{ backgroundColor: color }} title={label} aria-label={`${label}高亮`} onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.chain().setHighlight({ color }).run())} />)}</div>
              <label className="field-label" htmlFor="custom-highlight-color">自定义高亮</label>
              <div className="custom-color-row"><input id="custom-highlight-color" type="color" value={colorPickerValue(customHighlightHex)} onMouseDown={preserveSelection} onChange={(event) => { setCustomHighlightHex(event.target.value); applyHighlightColor(event.target.value); }} /><input value={customHighlightHex} maxLength={7} placeholder="#FEF08A" onMouseDown={preserveSelection} onChange={(event) => setCustomHighlightHex(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyHighlightColor(customHighlightHex); }} /><button className="button-subtle" type="button" onMouseDown={preserveSelection} onClick={() => applyAtSelection((active) => active.commands.unsetHighlight())}><RotateCcw size={13} />移除</button></div>
            </PopoverContent>
          </Popover>
        </div>
      </BubbleMenu>}
    </div>
  );
}

function insertPastedTable(view: EditorView, rows: string[][]) {
  const { schema } = view.state;
  const tableType = schema.nodes.table;
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const headerType = schema.nodes.tableHeader;
  const paragraphType = schema.nodes.paragraph;
  if (!tableType || !rowType || !cellType || !headerType || !paragraphType) return false;
  const tableRows = rows.map((cells, rowIndex) => rowType.create(null, cells.map((cell) => {
    const type = rowIndex === 0 ? headerType : cellType;
    const content = parseCellInlineMarkdown(cell, schema);
    return type.create(null, paragraphType.create(null, content));
  })));
  const table = tableType.create(null, tableRows);
  view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView());
  view.focus();
  return true;
}

function parseCellInlineMarkdown(value: string, schema: Schema): ProseMirrorNode[] {
  const pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g;
  const content: ProseMirrorNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) content.push(schema.text(value.slice(cursor, start)));
    let text = token;
    let markName: "bold" | "italic" | "strike" | "code" | "link" | null = null;
    let attrs: Record<string, string> | undefined;
    if (token.startsWith("**")) { markName = "bold"; text = token.slice(2, -2); }
    else if (token.startsWith("~~")) { markName = "strike"; text = token.slice(2, -2); }
    else if (token.startsWith("`")) { text = token.slice(1, -1); }
    else if (token.startsWith("*")) { markName = "italic"; text = token.slice(1, -1); }
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) { markName = "link"; text = link[1]; attrs = { href: link[2] }; }
    }
    const markType = markName ? schema.marks[markName] : undefined;
    content.push(markType ? schema.text(text, [markType.create(attrs)]) : schema.text(text));
    cursor = start + token.length;
  }
  if (cursor < value.length) content.push(schema.text(value.slice(cursor)));
  return content;
}

function selectedMarkAttribute(editor: TiptapEditor, attribute: string) {
  const { selection, doc, schema } = editor.state;
  if (selection.empty) return String(editor.getAttributes("textStyle")[attribute] ?? "");
  const markType = schema.marks.textStyle;
  if (!markType) return "";
  const values = new Set<string>();
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isText) return;
    const mark = markType.isInSet(node.marks);
    values.add(String(mark?.attrs[attribute] ?? ""));
  });
  return values.size > 1 ? "mixed" : [...values][0] ?? "";
}
