"use client";
import { ArrowLeft, Database } from "lucide-react";
import { useKnowledgeImportConflicts } from "@/components/knowledge-import-conflicts";

import { KnowledgeDialogs } from "@/components/knowledge-dialogs";
import { KnowledgeLibrary, refreshKnowledge, downloadKnowledgeFile } from "@/components/knowledge-library";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BookOpen, LibraryBig, ChevronDown, ChevronRight,
  Download, Ellipsis, FilePlus2, FileText, Folder, FolderOpen, Laptop, MoreHorizontal, NotebookPen, Pin, PinOff, Pencil,
  Check, ChevronRight as MenuChevron, LogOut, Moon, Sun, Monitor, UserRound, Save, Plus, Search, Settings, Trash2, X, GripVertical, PanelLeftClose,
  PanelLeftOpen, ArrowDownWideNarrow, Image as ImageIcon
} from "lucide-react";
import {
  DndContext, DragEndEvent, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor,
  closestCenter, useSensor, useSensors
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTheme } from "next-themes";
import type { Folder as FolderRecord, Notebook, Page } from "@/db/schema";
import { formatRelative } from "@/lib/time";
import { useConfirm } from "@/components/ui/alert-dialog";
import { useFormDialog } from "@/components/ui/dialog";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { autoSaveOptions } from "@/lib/auto-save";
import { waitForPageSaves, flushPageEdits } from "@/lib/page-save-queue";
import { useLogout, LogoutProgress } from "@/components/use-logout";
import { matchesShortcut } from "@/lib/keyboard-shortcuts";
import { useUiTypography } from "@/components/ui-typography-provider";
import { uiFontSizeOptions } from "@/lib/ui-typography";
import { WorkspaceLoading } from "@/components/workspace-loading";
import { PanelResizer, clampPagesWidth, MIN_PAGES_WIDTH, pagesWidthStorageKey } from "@/components/ui/panel-resizer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotebookHome } from "@/components/notebook-home";
import { CoverCropDialog } from "@/components/cover-crop-dialog";
import { safeFileName } from "@/lib/filename";
import { notify } from "@/lib/notifications";

const PageEditor = dynamic(() => import("@/components/page-editor").then((module) => module.PageEditor), {
  ssr: false,
  loading: () => <WorkspaceLoading />
});

type FolderItem = Pick<FolderRecord, "id" | "name" | "isDefault" | "sortOrder">;
type NotebookItem = Pick<Notebook, "id" | "folderId" | "title" | "coverAssetId" | "updatedAt" | "pinnedAt" | "pinSortOrder">;
type PageItem = Pick<Page, "id" | "notebookId" | "title" | "sortOrder" | "version" | "updatedAt" | "createdAt" | "pinnedAt" | "pinSortOrder"> & { summary?: string };
type SessionUser = { id: string; username: string; createdAt: string; role: string };
type Settings = { theme: "system" | "light" | "dark"; autoSaveMode: string; sidebarCollapsed: boolean };
type SnapshotItem = { id: string; title: string; createdAt: string };
type PinItem = { id: string; title: string; type: "notebook" | "page"; notebookId?: string };
type TrashItem = { id: string; title: string; type: "notebook" | "page"; deletedAt: string; remainingDays: number; originalLocation: string; notebookId?: string };
type SearchResult = { id: string; type: "folder" | "notebook" | "page"; title: string; folderId: string; folderName: string; notebookTitle: string; notebookId: string; pageId: string; summary: string; updatedAt: string };
const pageSortOptions = [
  { value: "manual", label: "手动排序" },
  { value: "updated", label: "最近更新" },
  { value: "created", label: "创建时间" },
  { value: "title", label: "标题" }
] as const;
type SortMode = typeof pageSortOptions[number]["value"];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "请求失败，请稍后重试");
  return result as T;
}

export function Workspace({ appVersion }: { appVersion: string }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const typography = useUiTypography();
  const confirm = useConfirm();
  const { chooseConflictPolicy, conflictDialog } = useKnowledgeImportConflicts();
  const ask = useFormDialog();
  const [pagesPanelWidth, setPagesPanelWidth] = useState(() => {
    if (typeof window === "undefined") return MIN_PAGES_WIDTH;
    try { return clampPagesWidth(Number(localStorage.getItem(pagesWidthStorageKey) ?? MIN_PAGES_WIDTH)); }
    catch { return MIN_PAGES_WIDTH; }
  });
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(pagesWidthStorageKey, String(pagesPanelWidth)); } catch { /* Layout remains usable without browser storage. */ } }, 150);
    return () => clearTimeout(timer);
  }, [pagesPanelWidth]);
  const pathname = usePathname();
  const knowledgeOpen = pathname === "/app/library";
  function setKnowledgeOpen(open: boolean) {
    const url = new URL(window.location.href);
    if ((url.pathname === "/app/library") === open) return;
    url.pathname = open ? "/app/library" : "/app";
    window.history.pushState(null, "", url);
  }
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const navigationRestored = useRef(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [notebooks, setNotebooks] = useState<NotebookItem[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState<NotebookItem | null>(null);
  const [selectedPage, setSelectedPage] = useState<Page | null>(null);
  const { logout, pending: loggingOut } = useLogout(async () => {
    if (selectedPage) await flushPageEdits(selectedPage.id);
  });
  const [editingNotebook, setEditingNotebook] = useState<NotebookItem | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [transferring, setTransferring] = useState(false);
  const transferRef = useRef(false);
  const navigationSequence = useRef(0);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverSavingRef = useRef(false);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const [editCoverFile, setEditCoverFile] = useState<File | null>(null);
  const [editCoverPreview, setEditCoverPreview] = useState("");
  const [settings, setSettings] = useState<Settings>({ theme: "system", autoSaveMode: "realtime", sidebarCollapsed: false });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<"devices" | "history" | "global-search" | "export" | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<SearchResult[]>([]);
  const [globalSearchBusy, setGlobalSearchBusy] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState("");
  const [exportScope, setExportScope] = useState<"page" | "notebook">("page");
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [pins, setPins] = useState<PinItem[]>([]);
  const trashOpen = pathname === "/app/trash";
  useEffect(() => { if (!trashOpen) return; const controller = new AbortController(); void requestJson<{ trash: TrashItem[] }>("/api/trash").then((data) => { if (!controller.signal.aborted) setTrashItems(data.trash); }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取垃圾箱"); }); return () => controller.abort(); }, [trashOpen]);
  function setTrashOpen(open: boolean) {
    const url = new URL(window.location.href);
    if (open) url.pathname = "/app/trash";
    else if (url.pathname === "/app/trash") url.pathname = "/app";
    else return;
    window.history.pushState(null, "", url);
  }
  const [trashQuery, setTrashQuery] = useState("");
  const [trashType, setTrashType] = useState("all");
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  function setError(message: string) {
    if (message) notify.error(message);
  }
  const [showPages, setShowPages] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [draggingPage, setDraggingPage] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [notebookMenuId, setNotebookMenuId] = useState<string | null>(null);
  const [editorReset, setEditorReset] = useState(0);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!editCoverPreview) return;
    return () => URL.revokeObjectURL(editCoverPreview);
  }, [editCoverPreview]);


  useEffect(() => {
    if (modal !== "global-search") return;
    const query = globalQuery.trim();
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setGlobalSearchBusy(true);
      void requestJson<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((result) => { if (controller.signal.aborted) return; setGlobalResults(result.results); setGlobalSearchError(""); })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setGlobalSearchError(cause instanceof Error ? cause.message : "搜索失败");
        })
        .finally(() => { if (!controller.signal.aborted) setGlobalSearchBusy(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [globalQuery, modal]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (matchesShortcut(event, "f", true)) {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        event.preventDefault();
        setGlobalQuery("");
        setGlobalResults([]);
        setGlobalSearchError("");
        setGlobalSearchBusy(false);
        setModal("global-search");
      }
      if (!matchesShortcut(event, "\\")) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      const sidebarCollapsed = !settings.sidebarCollapsed;
      void requestJson<{ settings: Settings }>("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sidebarCollapsed })
      }).then((result) => {
        setSettings(result.settings);
      }).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "无法保存侧栏设置");
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings.sidebarCollapsed]);

  const loadWorkspace = useCallback(async () => {
    try {
      const [me, folderResult, notebookResult, settingResult, pinResult] = await Promise.all([
        requestJson<{ user: SessionUser }>("/api/auth/me"),
        requestJson<{ folders: FolderItem[] }>("/api/folders"),
        requestJson<{ notebooks: NotebookItem[] }>("/api/notebooks"),
        requestJson<{ settings: Settings; user: SessionUser }>("/api/settings"),
        requestJson<{ pins: PinItem[] }>("/api/pins")
      ]);
      if (me.user.role === "ADMIN") {
        router.replace("/admin");
        return;
      }
      setUser(me.user);
      setFolders(folderResult.folders);
      setNotebooks(notebookResult.notebooks);
      setPins(pinResult.pins);
      setSettings(settingResult.settings);
      setTheme(settingResult.settings.theme);
      setExpandedFolders(new Set(folderResult.folders.map((item) => item.id)));
      if (!navigationRestored.current) {
        navigationRestored.current = true;
        const pageId = new URL(window.location.href).searchParams.get("page");
        const notebookId = new URL(window.location.href).searchParams.get("notebook");
        if (!pageId && notebookId) {
          const notebook = notebookResult.notebooks.find((item) => item.id === notebookId);
          if (notebook) {
            const result = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${notebook.id}/pages`);
            setSelectedNotebook(notebook); setPages(result.pages);
          } else clearPageLocation();
        }
        if (pageId) {
          try {
            await waitForPageSaves(pageId);
            const { page } = await requestJson<{ page: Page }>(`/api/pages/${encodeURIComponent(pageId)}`);
            const notebook = notebookResult.notebooks.find((item) => item.id === page.notebookId);
            if (notebook) {
              const result = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${notebook.id}/pages`);
              setSelectedNotebook(notebook);
              setPages(result.pages);
              setSelectedPage(page);
            } else clearPageLocation();
          } catch { clearPageLocation(); }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载工作空间");
      if (cause instanceof Error && cause.message.includes("登录")) router.replace("/login");
    } finally { setWorkspaceReady(true); }
  }, [router, setTheme]);

  useEffect(() => {
    const timer = setTimeout(() => { void loadWorkspace(); }, 0);
    return () => clearTimeout(timer);
  }, [loadWorkspace]);

  const selectedPageId = selectedPage?.id;
  useEffect(() => {
    if (!selectedPageId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", selectedPageId);
    if (selectedPage?.notebookId) url.searchParams.set("notebook", selectedPage.notebookId);
    window.history.replaceState(null, "", url);
  }, [selectedPageId, selectedPage?.notebookId]);

  function clearPageLocation() {
    const url = new URL(window.location.href);
    url.searchParams.delete("page");
    url.searchParams.delete("notebook");
    window.history.replaceState(null, "", url);
  }

  async function openNotebook(notebook: NotebookItem) {
    setKnowledgeOpen(false);
    const sequence = ++navigationSequence.current;
    try {
      if (selectedPage) await flushPageEdits(selectedPage.id);
      const result = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${notebook.id}/pages`);
      const first = result.pages[0];
      if (first) await waitForPageSaves(first.id);
      const detail = first ? await requestJson<{ page: Page }>(`/api/pages/${first.id}`) : null;
      if (sequence !== navigationSequence.current) return;
      setTrashOpen(false); setSelectedNotebook(notebook); setPages(result.pages);
      setSelectedPage(detail?.page ?? null); setShowPages(!detail); setShowSidebar(false);
      const url = new URL(window.location.href);
      url.searchParams.set("notebook", notebook.id);
      if (detail) url.searchParams.set("page", detail.page.id); else url.searchParams.delete("page");
      window.history.pushState(null, "", url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载页面"); }
  }

  async function goHome() {
    setKnowledgeOpen(false);
    try {
      if (selectedPage) await flushPageEdits(selectedPage.id);
      navigationSequence.current++;
      setSelectedNotebook(null); setSelectedPage(null); setPages([]);
      setTrashOpen(false); setShowSidebar(false); setShowPages(false);
      router.push("/app");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "请先保存当前页面"); }
  }

  // Browser Back/Forward restores the matching home/notebook/page without a full reload.
  useEffect(() => {
    const restore = async () => {
      const sequence = ++navigationSequence.current;
      try {
        if (selectedPage) await flushPageEdits(selectedPage.id);
        const url = new URL(window.location.href);
        if (url.pathname === "/app/trash") return;
        const pageId = url.searchParams.get("page");
        const detail = pageId ? await requestJson<{ page: Page }>(`/api/pages/${encodeURIComponent(pageId)}`) : null;
        const notebookId = detail?.page.notebookId ?? url.searchParams.get("notebook");
        const notebook = notebooks.find((item) => item.id === notebookId) ?? null;
        const result = notebook ? await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${notebook.id}/pages`) : null;
        if (sequence !== navigationSequence.current) return;
        setSelectedNotebook(notebook); setSelectedPage(detail?.page ?? null); setPages(result?.pages ?? []); setTrashOpen(false);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "无法恢复导航"); }
    };
    const handler = () => { void restore(); };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [selectedPage, notebooks]);

  async function exportCnf(notebook: NotebookItem) {
    if (transferRef.current) return;
    transferRef.current = true; setTransferring(true);
    try {
      if (selectedNotebook?.id === notebook.id && selectedPage) await flushPageEdits(selectedPage.id);
      const list = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${notebook.id}/pages`);
      await Promise.all(list.pages.map((page) => waitForPageSaves(page.id)));
      const response = await fetch(`/api/notebooks/${notebook.id}/cnf`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error ?? "笔记本导出失败");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${safeFileName(notebook.title)}.cnf`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      notify.success("CNF 笔记本下载已开始");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "笔记本导出失败"); }
    finally { transferRef.current = false; setTransferring(false); }
  }

  async function importCnf(file: File) {
    if (transferRef.current) return;
    if (!/\.cnf$/i.test(file.name)) return setError("请选择 .cnf 笔记本文件");
    if (!file.size || file.size > 100 * 1024 * 1024) return setError("CNF 文件必须为 1 字节至 100 MB");
    transferRef.current = true; setTransferring(true);
    try {
      const form = new FormData(); form.set("file", file);
      let response = await fetch("/api/notebooks/import", { method: "POST", body: form });
      if (response.status === 409) {
        const conflict = await response.json();
        const policy = await chooseConflictPolicy(conflict);
        if (!policy) return;
        form.set("conflictPolicy", policy); response = await fetch("/api/notebooks/import", { method: "POST", body: form });
      }
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "导入失败");
      await loadWorkspace(); refreshKnowledge();
      if (result.notebook.kind === "knowledge") setKnowledgeOpen(true);
      notify.success(result.notebook.kind === "knowledge" ? "知识库导入完成" : `已导入笔记本「${result.notebook.title}」`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "笔记本导入失败"); }
    finally { transferRef.current = false; setTransferring(false); }
  }

  async function openPage(id: string) {
    setKnowledgeOpen(false);
    if (selectedPage && selectedPage.id !== id) {
      try { await flushPageEdits(selectedPage.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "请先保存当前页面"); return; }
    }
    setTrashOpen(false);
    await waitForPageSaves(id);
    try {
      const result = await requestJson<{ page: Page }>(`/api/pages/${id}`);
      setSelectedPage(result.page);
      setShowPages(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开页面");
    }
  }

  async function createFolder() {
    const input = await ask({ title: "新建文件夹", submitLabel: "创建", fields: [{ name: "name", label: "文件夹名称", placeholder: "例如：学习笔记", maxLength: 80 }] });
    const name = input?.values.name.trim();
    if (!name) return;
    try {
      const result = await requestJson<{ folder: FolderItem }>("/api/folders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name })
      });
      setFolders((current) => [...current, result.folder]);
      setExpandedFolders((current) => new Set(current).add(result.folder.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建文件夹"); }
  }

  async function renameFolder(folder: FolderItem) {
    const input = await ask({ title: "重命名文件夹", submitLabel: "保存", fields: [{ name: "name", label: "文件夹名称", value: folder.name, maxLength: 80 }] });
    const name = input?.values.name.trim();
    if (!name || name === folder.name) return;
    try {
      const result = await requestJson<{ folder: FolderItem }>(`/api/folders/${folder.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name })
      });
      setFolders((current) => current.map((item) => item.id === folder.id ? result.folder : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法修改文件夹"); }
  }

  async function removeFolder(folder: FolderItem) {
    if (folder.isDefault || !await confirm(`删除「${folder.name}」？其中的笔记本将移动至默认文件夹。`, "删除文件夹")) return;
    try {
      await requestJson(`/api/folders/${folder.id}`, { method: "DELETE" });
      const defaultFolder = folders.find((item) => item.isDefault);
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      if (defaultFolder) setNotebooks((current) => current.map((book) => book.folderId === folder.id ? { ...book, folderId: defaultFolder.id } : book));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除文件夹"); }
  }

  async function createNotebook(folder: FolderItem) {
    const input = await ask({
      title: "新建笔记本",
      submitLabel: "创建笔记本",
      fields: [
        { name: "title", label: "笔记本名称", placeholder: "例如：产品研究", maxLength: 120 },
        { name: "folderId", label: "目标文件夹", value: folder.id, options: folders.map((item) => ({ value: item.id, label: item.name })) },
        { name: "coverFile", label: "封面图片", type: "file", cropNotebookCover: true, accept: "image/jpeg,image/png,image/webp,image/gif" }
      ]
    });
    if (!input) return;
    const title = input.values.title.trim();
    if (!title) return;
    const targetFolder = folders.find((item) => item.id === input?.values.folderId);
    if (!targetFolder) return setError("目标文件夹不存在");
    try {
      const result = await requestJson<{ notebook: NotebookItem }>("/api/notebooks", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, folderId: targetFolder.id })
      });
      setNotebooks((current) => [...current, result.notebook]);
      setExpandedFolders((current) => new Set(current).add(targetFolder.id));
      const coverFile = input.files.coverFile;
      const notebook = coverFile ? await changeCover(result.notebook, coverFile) : result.notebook;
      await openNotebook(notebook);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建笔记本"); }
  }

  async function renameNotebook(notebook: NotebookItem) {
    const input = await ask({ title: "重命名笔记本", submitLabel: "保存", fields: [{ name: "title", label: "笔记本名称", value: notebook.title, maxLength: 120 }] });
    const title = input?.values.title.trim();
    if (!title || title === notebook.title) return;
    try {
      const result = await requestJson<{ notebook: NotebookItem }>(`/api/notebooks/${notebook.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title })
      });
      updateNotebook(result.notebook);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法修改笔记本"); }
  }

  function editNotebook(notebook: NotebookItem) {
    setEditCoverFile(null);
    setEditCoverPreview("");
    setCoverRemoved(false);
    setEditingNotebook(notebook);
  }

  async function saveNotebookEdits() {
    if (!editingNotebook || coverSavingRef.current) return;
    coverSavingRef.current = true;
    setCoverSaving(true);
    try {
      if (editCoverFile) await changeCover(editingNotebook, editCoverFile);
      else if (coverRemoved) {
        const result = await requestJson<{ notebook: NotebookItem }>(`/api/notebooks/${editingNotebook.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverAssetId: null })
        });
        updateNotebook(result.notebook);
      }
      setEditingNotebook(null);
      setEditCoverFile(null);
      notify.success("笔记本已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法编辑笔记本");
    } finally {
      coverSavingRef.current = false;
      setCoverSaving(false);
    }
  }

  function updateNotebook(updated: NotebookItem) {
    setNotebooks((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedNotebook((current) => current?.id === updated.id ? updated : current);
    setEditingNotebook((current) => current?.id === updated.id ? updated : current);
  }

  async function moveNotebook(notebook: NotebookItem) {
    const candidates = folders.filter((folder) => folder.id !== notebook.folderId);
    if (!candidates.length) return setError("请先创建另一个文件夹");
    const input = await ask({
      title: "移动笔记本",
      submitLabel: "移动",
      fields: [{ name: "folderId", label: "目标文件夹", value: candidates[0].id, options: candidates.map((folder) => ({ value: folder.id, label: folder.name })) }]
    });
    const target = candidates.find((folder) => folder.id === input?.values.folderId);
    if (!target) return;
    try {
      const result = await requestJson<{ notebook: NotebookItem }>(`/api/notebooks/${notebook.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: target.id })
      });
      setNotebooks((current) => current.map((item) => item.id === notebook.id ? result.notebook : item));
      if (selectedNotebook?.id === notebook.id) setSelectedNotebook(result.notebook);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法移动笔记本"); }
  }

  async function removeNotebook(notebook: NotebookItem) {
    if (!await confirm(`将笔记本「${notebook.title}」及其页面移入垃圾箱？7 天内可以恢复。`, "移入垃圾箱")) return;
    try {
      if (selectedNotebook?.id === notebook.id && selectedPage) await flushPageEdits(selectedPage.id);
      await requestJson(`/api/notebooks/${notebook.id}`, { method: "DELETE" });
      setNotebooks((current) => current.filter((item) => item.id !== notebook.id));
      setPins((current) => current.filter((item) => item.id !== notebook.id && item.notebookId !== notebook.id));
      if (selectedNotebook?.id === notebook.id) {
        setSelectedNotebook(null); setSelectedPage(null); setPages([]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除笔记本"); }
  }

  async function changeCover(notebook: NotebookItem, file: File) {
    const form = new FormData();
    form.append("file", file);
    const uploaded = await requestJson<{ asset: { id: string } }>("/api/assets/upload", { method: "POST", body: form });
    const result = await requestJson<{ notebook: NotebookItem }>(`/api/notebooks/${notebook.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverAssetId: uploaded.asset.id })
    });
    updateNotebook(result.notebook);
    return result.notebook;
  }

  async function removeCover(notebook: NotebookItem) {
    if (!notebook.coverAssetId) return;
    try {
      const result = await requestJson<{ notebook: NotebookItem }>(`/api/notebooks/${notebook.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coverAssetId: null })
      });
      updateNotebook(result.notebook);
      notify.success("已移除笔记本封面");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法移除封面"); }
  }

  async function reorderPages(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedNotebook || sortMode !== "manual") return;
    const from = pages.findIndex((page) => page.id === active.id);
    const to = pages.findIndex((page) => page.id === over.id);
    if (from < 0 || to < 0) return;
    const previous = pages;
    const reordered = arrayMove(pages, from, to);
    setPages(reordered);
    try {
      await requestJson("/api/pages/reorder", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: selectedNotebook.id, pageIds: reordered.map((page) => page.id) })
      });
    } catch (cause) {
      setPages(previous);
      setError(cause instanceof Error ? cause.message : "无法保存页面排序");
    }
  }

  async function createPage() {
    if (!notebooks.length) return setError("请先创建一个笔记本");
    const input = await ask({
      title: "新建页面",
      submitLabel: "创建页面",
      fields: [
        { name: "title", label: "页面标题", value: "无标题", maxLength: 200 },
        { name: "notebookId", label: "目标笔记本", value: selectedNotebook?.id ?? notebooks[0].id, options: notebooks.map((book) => ({ value: book.id, label: book.title })) }
      ]
    });
    if (!input) return;
    const targetNotebook = notebooks.find((book) => book.id === input.values.notebookId);
    if (!targetNotebook) return setError("目标笔记本不存在");
    try {
      const result = await requestJson<{ page: Page }>("/api/notebooks/" + targetNotebook.id + "/pages", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: input.values.title.trim() || "无标题" })
      });
      if (selectedNotebook?.id === targetNotebook.id) setPages((current) => [result.page, ...current]);
      else {
        setSelectedNotebook(targetNotebook);
        const pageList = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${targetNotebook.id}/pages`);
        setPages(pageList.pages);
      }
      setSelectedPage(result.page);
      setShowPages(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法创建页面"); }
  }

  async function renamePage(page: PageItem) {
    const input = await ask({ title: "重命名页面", submitLabel: "保存", fields: [{ name: "title", label: "页面标题", value: page.title, maxLength: 200 }] });
    const title = input?.values.title.trim();
    if (!title || title === page.title) return;
    try {
      await flushPageEdits(page.id);
      const full = (await requestJson<{ page: Page }>(`/api/pages/${page.id}`)).page;
      const result = await requestJson<{ page: Page }>(`/api/pages/${page.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: full.content, version: full.version })
      });
      setPages((current) => current.map((item) => item.id === page.id ? { ...item, title: result.page.title, version: result.page.version, updatedAt: result.page.updatedAt } : item));
      if (selectedPage?.id === page.id) {
        setSelectedPage(result.page);
        setEditorReset((value) => value + 1);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法修改页面"); }
  }

  async function removePage(page: PageItem) {
    if (!await confirm(`将页面「${page.title}」移入垃圾箱？7 天内可以恢复。`, "移入垃圾箱")) return;
    try {
      await flushPageEdits(page.id);
      await requestJson(`/api/pages/${page.id}`, { method: "DELETE" });
      const remaining = pages.filter((item) => item.id !== page.id);
      setPins((current) => current.filter((item) => item.id !== page.id));
      setPages(remaining);
      if (selectedPage?.id === page.id) {
        setSelectedPage(null);
        if (remaining[0]) await openPage(remaining[0].id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除页面"); }
  }

  async function togglePin(type: "notebook" | "page", id: string, pinned: boolean) {
    try {
      await requestJson("/api/pins", {
        method: pinned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id })
      });
      const result = await requestJson<{ pins: PinItem[] }>("/api/pins");
      setPins(result.pins);
      const pinnedAt = pinned ? null : new Date().toISOString();
      if (type === "notebook") {
        setNotebooks((current) => current.map((item) => item.id === id ? { ...item, pinnedAt } : item));
        setSelectedNotebook((current) => current?.id === id ? { ...current, pinnedAt } : current);
      } else {
        setPages((current) => current.map((item) => item.id === id ? { ...item, pinnedAt } : item));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法更新置顶状态"); }
  }

  async function openPinnedItem(item: PinItem) {
    if (item.type === "notebook") {
      const notebook = notebooks.find((candidate) => candidate.id === item.id);
      if (notebook) await openNotebook(notebook);
      return;
    }
    const notebook = notebooks.find((candidate) => candidate.id === item.notebookId);
    if (!notebook) return setError("置顶页面所在笔记本不可用");
    await openNotebook(notebook);
    await openPage(item.id);
  }

  async function openTrash() {
    try {
      if (selectedPage) await flushPageEdits(selectedPage.id);
      const result = await requestJson<{ trash: TrashItem[] }>("/api/trash");
      setTrashItems(result.trash);
      setKnowledgeOpen(false);
      setTrashOpen(true);
      setShowSidebar(false);
      setShowPages(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开垃圾箱"); }
  }

  function openGlobalSearch() {
    setGlobalQuery("");
    setGlobalResults([]);
    setGlobalSearchError("");
    setGlobalSearchBusy(false);
    setModal("global-search");
  }

  async function openSearchResult(result: SearchResult) {
    setModal(null);
    setGlobalQuery("");
    if (result.type === "folder") {
      navigateFolder(result.folderId);
      setExpandedFolders((current) => new Set(current).add(result.folderId));
      return;
    }
    const notebook = notebooks.find((item) => item.id === result.notebookId);
    if (!notebook) return setError("搜索结果所属笔记本不可用");
    if (result.type === "notebook") {
      await openNotebook(notebook);
      return;
    }
    await openNotebook(notebook);
    await openPage(result.pageId);
  }

  function exportSelection() {
    if (!selectedPage || !selectedNotebook) return;
    const path = exportScope === "page"
      ? `/print/page/${selectedPage.id}`
      : `/print/notebook/${selectedNotebook.id}`;
    setModal(null);
    window.open(path, "_blank", "noopener,noreferrer");
  }

  async function restoreTrashItem(item: TrashItem) {
    try {
      await requestJson("/api/trash", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: item.type, id: item.id })
      });
      setTrashItems((current) => current.filter((candidate) => candidate.id !== item.id || candidate.type !== item.type));
      await loadWorkspace();
      if (item.type === "page" && selectedNotebook?.id === item.notebookId) {
        const pageList = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${item.notebookId}/pages`);
        setPages(pageList.pages);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法恢复项目"); }
  }

  async function permanentlyDeleteTrashItem(item: TrashItem) {
    if (!await confirm(`确定要永久删除「${item.title}」吗？此操作无法通过垃圾箱恢复。`, "永久删除")) return;
    try {
      await requestJson(`/api/trash/${item.type}/${item.id}`, { method: "DELETE" });
      setTrashItems((current) => current.filter((candidate) => candidate.id !== item.id || candidate.type !== item.type));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法永久删除项目"); }
  }

  async function emptyTrash() {
    if (!trashItems.length || !await confirm("确定清空垃圾箱吗？其中所有项目将被永久删除，无法恢复。", "清空垃圾箱")) return;
    try {
      await requestJson("/api/trash", { method: "DELETE" });
      setTrashItems([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法清空垃圾箱"); }
  }

  async function openHistory() {
    if (!selectedPage) return;
    try {
      const result = await requestJson<{ snapshots: SnapshotItem[] }>(`/api/pages/${selectedPage.id}/snapshots`);
      setSnapshots(result.snapshots);
      setPreview(null);
      setModal("history");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取历史记录"); }
  }

  async function previewSnapshot(snapshot: SnapshotItem) {
    try {
      const result = await requestJson<{ snapshot: { title: string; content: string } }>(`/api/pages/${selectedPage?.id}/snapshots/${snapshot.id}`);
      setPreview(result.snapshot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法预览历史记录"); }
  }

  async function restoreSnapshot(snapshot: SnapshotItem) {
    if (!selectedPage || !await confirm("恢复后当前正文会保留为一个新历史版本，确定继续？", "恢复版本")) return;
    try {
      await flushPageEdits(selectedPage.id);
      const result = await requestJson<{ page: Page }>(`/api/pages/${selectedPage.id}/restore`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshotId: snapshot.id })
      });
      setSelectedPage(result.page);
      setPages((current) => current.map((item) => item.id === result.page.id ? { ...item, title: result.page.title, version: result.page.version, updatedAt: result.page.updatedAt } : item));
      setEditorReset((value) => value + 1);
      setModal(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法恢复历史版本"); }
  }

  async function deleteSnapshot(snapshot: SnapshotItem) {
    if (!selectedPage || !await confirm("删除这条历史版本？", "删除版本")) return;
    try {
      await requestJson(`/api/pages/${selectedPage.id}/snapshots/${snapshot.id}`, { method: "DELETE" });
      setSnapshots((current) => current.filter((item) => item.id !== snapshot.id));
      if (preview && snapshot.title === preview.title) setPreview(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除历史版本"); }
  }

  async function clearHistory() {
    if (!selectedPage || !await confirm("清空此页面的全部历史记录？当前正文不会改变。", "清空历史")) return;
    try {
      await requestJson(`/api/pages/${selectedPage.id}/snapshots`, { method: "DELETE" });
      setSnapshots([]);
      setPreview(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法清空历史记录"); }
  }

  async function saveSettings(update: Partial<Settings>) {
    try {
      const result = await requestJson<{ settings: Settings }>("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update)
      });
      setSettings(result.settings);
      if (update.theme) setTheme(update.theme);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存设置"); }
  }


  async function navigateKnowledgeSource(id: string, target?: string) {
    try {
      if (selectedPage) await flushPageEdits(selectedPage.id);
      const { page } = await requestJson<{ page: Page }>(`/api/pages/${id}`);
      const notebook = notebooks.find((item) => item.id === page.notebookId);
      if (!notebook) throw new Error("来源笔记本不存在");
      const result = await requestJson<{ pages: PageItem[] }>(`/api/notebooks/${notebook.id}/pages`);
      setKnowledgeOpen(false); setTrashOpen(false); setSelectedNotebook(notebook); setPages(result.pages); setSelectedPage(page); setEditorReset((value) => value + 1); setShowPages(false); setShowSidebar(false);
      const url = new URL(window.location.href); url.searchParams.set("page", page.id); url.searchParams.set("notebook", notebook.id); window.history.pushState(null, "", url);
      if (target) {
        for (let index = 0; index < 30; index++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const node = document.querySelector<HTMLElement>(`.notebook-editor [data-entry-id="${window.CSS.escape(target)}"]`);
          if (node) { node.scrollIntoView({ block: "center", behavior: "smooth" }); node.classList.add("knowledge-reference-locate"); setTimeout(() => node.classList.remove("knowledge-reference-locate"), 1600); break; }
        }
      }
    } catch (error) { setError(error instanceof Error ? error.message : "无法打开来源页面"); }
  }

  const visiblePages = useMemo(() => {
    const filtered = pages;
    if (sortMode === "updated") return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sortMode === "created") return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sortMode === "title") return [...filtered].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return filtered;
  }, [pages, sortMode]);

  function navigateFolder(folderId: string) {
    setKnowledgeOpen(false);
    clearPageLocation();
    setTrashOpen(false);
    setExpandedFolders((current) => new Set(current).add(folderId));
    setSelectedNotebook(null);
    setSelectedPage(null);
    setPages([]);
    setShowPages(false);
    setShowSidebar(true);
  }

  function updateSavedPage(page: Pick<Page, "id" | "title" | "version" | "updatedAt">) {
    setPages((current) => current.map((item) => item.id === page.id ? { ...item, ...page } : item));
    setSelectedPage((current) => current?.id === page.id ? { ...current, ...page } : current);
  }

  const isHome = knowledgeOpen || trashOpen || !selectedNotebook;

  if (!workspaceReady) return <WorkspaceLoading />;

  return (
    <main style={{ "--pages-panel-width": `${pagesPanelWidth}px` } as CSSProperties} className={`workspace ${isHome ? "notebook-home-layout" : ""} ${settings.sidebarCollapsed ? "sidebar-collapsed" : ""} ${showPages ? "show-pages" : ""} ${showSidebar ? "show-sidebar" : ""}`}>
      <LogoutProgress pending={loggingOut} />
      {conflictDialog}
      <KnowledgeDialogs autoSaveMode={settings.autoSaveMode} activePageId={selectedPage?.id} onNavigatePage={navigateKnowledgeSource} onRepaired={async (id, type) => { if (type === "page" && selectedPage?.id === id) { const { page } = await requestJson<{ page: Page }>(`/api/pages/${id}`); setSelectedPage(page); setEditorReset((value) => value + 1); } }} />
      <aside className="sidebar">
        <div className="brand-row">
          <a className="brand-home-link" href="/app" onClick={(event) => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void goHome(); }}><span className="brand-small"><Image src="/icon.png" alt="" width={24} height={24} unoptimized /></span><span>Cloud Notebook</span></a>
          <button className="icon-button mobile-sidebar-close" title="关闭导航" aria-label="关闭导航" onClick={() => setShowSidebar(false)}><X size={16} /></button>
        </div>
        <div className="sidebar-brand-divider" />
        <button className={`sidebar-knowledge-button ${knowledgeOpen ? "active" : ""}`} type="button" aria-current={knowledgeOpen ? "page" : undefined} onClick={() => void (async () => { try { if (selectedPage) await flushPageEdits(selectedPage.id); setKnowledgeOpen(true); setTrashOpen(false); setShowSidebar(false); refreshKnowledge(); } catch (error) { setError(error instanceof Error ? error.message : "请先保存页面"); } })()}><LibraryBig size={15} />知识库</button>
        {pins.length > 0 && <ScrollArea className="pinned-section" label="置顶列表">
          <div className="section-label pinned-section-title"><Pin size={13} />置顶</div>
          {pins.map((item) => <div className="pinned-row" key={`${item.type}:${item.id}`}>
            <button className="pinned-item" type="button" title={item.title} onClick={() => void openPinnedItem(item)}>
              {item.type === "notebook" ? <NotebookPen size={15} /> : <FileText size={15} />}<span>{item.title}</span>
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild><button className="icon-button pinned-more" aria-label={`${item.title} 置顶操作`} title="置顶操作"><MoreHorizontal size={15} /></button></DropdownMenu.Trigger>
              <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
                <DropdownMenu.Item className="menu-item" onSelect={() => void togglePin(item.type, item.id, true)}><PinOff size={15} />取消置顶</DropdownMenu.Item>
              </DropdownMenu.Content></DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>)}
        </ScrollArea>}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><button className="workspace-new-button"><Plus size={16} />新建<ChevronDown size={14} /></button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="start" sideOffset={6}>
            <DropdownMenu.Item className="menu-item" onSelect={() => void createFolder()}><Folder size={15} />新建文件夹</DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => {
              const folder = folders.find((item) => item.id === selectedNotebook?.folderId) ?? folders.find((item) => item.isDefault);
              if (folder) void createNotebook(folder);
              else setError("请先创建文件夹");
            }}><BookOpen size={15} />新建笔记本</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className="section-label workspace-section-label">工作空间</div>
        <ScrollArea className="folder-tree" label="工作空间列表">
          {folders.map((folder) => {
            const isOpen = expandedFolders.has(folder.id);
            const folderNotebooks = notebooks.filter((notebook) => notebook.folderId === folder.id);
            return <section className="folder-section" key={folder.id}>
              <div className="folder-row" onContextMenu={(event) => { event.preventDefault(); setFolderMenuId(folder.id); }}>
                <button className="folder-expand" type="button" aria-label={isOpen ? `收起${folder.name}` : `展开${folder.name}`} aria-expanded={isOpen} onClick={() => setExpandedFolders((current) => {
                  const next = new Set(current);
                  if (isOpen) next.delete(folder.id);
                  else next.add(folder.id);
                  return next;
                })}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
                {isOpen ? <FolderOpen size={16} className="folder-icon" /> : <Folder size={16} className="folder-icon" />}
                <button className="folder-name" type="button" onClick={() => setExpandedFolders((current) => {
                  const next = new Set(current);
                  if (isOpen) next.delete(folder.id);
                  else next.add(folder.id);
                  return next;
                })}>{folder.name}</button>
                <span className="folder-controls">
                  <DropdownMenu.Root open={folderMenuId === folder.id} onOpenChange={(open) => setFolderMenuId(open ? folder.id : null)}>
                    <DropdownMenu.Trigger asChild><button className="icon-button" type="button" title="文件夹操作" aria-label={`${folder.name} 操作`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
                    <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
                      <DropdownMenu.Item className="menu-item" onSelect={() => void createNotebook(folder)}><Plus size={14} />新建笔记本</DropdownMenu.Item>
                      {!folder.isDefault && <>
                        <DropdownMenu.Item className="menu-item" onSelect={() => void renameFolder(folder)}><Pencil size={14} />重命名</DropdownMenu.Item>
                        <DropdownMenu.Item className="menu-item destructive" onSelect={() => void removeFolder(folder)}><Trash2 size={14} />删除文件夹</DropdownMenu.Item>
                      </>}
                    </DropdownMenu.Content></DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </span>
              </div>
              <div className={`folder-content nested-notebooks ${isOpen ? "expanded" : ""}`} aria-hidden={!isOpen} inert={!isOpen}>
                {folderNotebooks.map((notebook) => <div key={notebook.id} onContextMenu={(event) => { event.preventDefault(); setNotebookMenuId(notebook.id); }} className={`notebook-row ${selectedNotebook?.id === notebook.id ? "selected" : ""}`}>
                  <NotebookPen size={16} className="notebook-icon" />
                  <button className="notebook-name" type="button" title={notebook.title} onClick={() => void openNotebook(notebook)}>{notebook.title}</button>
                  <DropdownMenu.Root open={notebookMenuId === notebook.id} onOpenChange={(open) => setNotebookMenuId(open ? notebook.id : null)}>
                    <DropdownMenu.Trigger asChild><button className="icon-button notebook-more" type="button" title="笔记本操作" aria-label={`${notebook.title} 操作`}><MoreHorizontal size={16} /></button></DropdownMenu.Trigger>
                    <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
                      <DropdownMenu.Item className="menu-item" onSelect={() => void togglePin("notebook", notebook.id, Boolean(notebook.pinnedAt))}>
                        {notebook.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}{notebook.pinnedAt ? "取消置顶" : "置顶笔记本"}
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="menu-item" onSelect={() => void renameNotebook(notebook)}><Pencil size={14} />重命名</DropdownMenu.Item>
                      <DropdownMenu.Item className="menu-item" onSelect={() => void editNotebook(notebook)}><ImageIcon size={14} />编辑封面</DropdownMenu.Item>
                      <DropdownMenu.Item className="menu-item" onSelect={() => void moveNotebook(notebook)}><Folder size={14} />移动到文件夹</DropdownMenu.Item>
                      {notebook.coverAssetId && <DropdownMenu.Item className="menu-item" onSelect={() => void removeCover(notebook)}><ImageIcon size={14} />移除封面</DropdownMenu.Item>}
                      <DropdownMenu.Item className="menu-item" disabled={transferring} onSelect={() => void exportCnf(notebook)}><Download size={14} />导出笔记本 (.cnf)</DropdownMenu.Item>
                      <DropdownMenu.Separator className="menu-separator" />
                      <DropdownMenu.Item className="menu-item destructive" onSelect={() => void removeNotebook(notebook)}><Trash2 size={14} />删除笔记本</DropdownMenu.Item>
                    </DropdownMenu.Content></DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>)}
              </div>
            </section>;
          })}
        </ScrollArea>
        <button className={`sidebar-trash-button ${trashOpen ? "active" : ""}`} aria-current={trashOpen ? "page" : undefined} type="button" onClick={() => void openTrash()}><Trash2 size={15} />垃圾箱</button>
        <footer className="sidebar-footer">
          <span className="user-avatar">{user?.username?.slice(0, 1).toLocaleUpperCase() ?? "U"}</span>
          <div className="sidebar-account"><span className="user-name" title={user?.username}>{user?.username ?? "正在加载"}</span><span>Unlimited Access</span></div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button className="icon-button" title="账号与设置" aria-label="账号与设置"><Settings size={17} /></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end" sideOffset={5}>
              <DropdownMenu.Label className="settings-menu-label">账号与设置</DropdownMenu.Label>
              <DropdownMenu.Sub><DropdownMenu.SubTrigger className="menu-item"><Database size={16} />数据管理<MenuChevron className="menu-chevron" size={14} /></DropdownMenu.SubTrigger><DropdownMenu.Portal><DropdownMenu.SubContent className="menu-content" sideOffset={6}><DropdownMenu.Item className="menu-item" onSelect={() => window.dispatchEvent(new Event("cloud-notebook:reference-check"))}>引用管理</DropdownMenu.Item></DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item"><Sun size={16} />外观<MenuChevron className="menu-chevron" size={14} /></DropdownMenu.SubTrigger>
                <DropdownMenu.Portal><DropdownMenu.SubContent className="menu-content" sideOffset={6}>
                  <DropdownMenu.RadioGroup value={settings.theme} onValueChange={(theme) => void saveSettings({ theme: theme as Settings["theme"] })}>
                    {([ ["light", "浅色", Sun], ["dark", "深色", Moon], ["system", "跟随系统", Monitor] ] as const).map(([value, label, Icon]) => <DropdownMenu.RadioItem className="menu-item settings-radio-item" key={value} value={value}><Icon size={16} />{label}<DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent></DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item"><NotebookPen size={16} />界面字号<MenuChevron className="menu-chevron" size={14} /></DropdownMenu.SubTrigger>
                <DropdownMenu.Portal><DropdownMenu.SubContent className="menu-content" sideOffset={6}>
                  <DropdownMenu.RadioGroup value={typography.size} onValueChange={(value) => {
                    const selected = uiFontSizeOptions.find((option) => option.value === value);
                    if (selected) void typography.setSize(selected.value);
                  }}>
                    {uiFontSizeOptions.map(({ value, label }) => <DropdownMenu.RadioItem className="menu-item settings-radio-item" key={value} value={value} disabled={typography.pending}>{label}<DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent></DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item"><Save size={16} />自动保存<MenuChevron className="menu-chevron" size={14} /></DropdownMenu.SubTrigger>
                <DropdownMenu.Portal><DropdownMenu.SubContent className="menu-content" sideOffset={6}>
                  <DropdownMenu.RadioGroup value={settings.autoSaveMode} onValueChange={(autoSaveMode) => void saveSettings({ autoSaveMode })}>
                    {autoSaveOptions.map(({ value, label }) => <DropdownMenu.RadioItem className="menu-item settings-radio-item" key={value} value={value}>{label}<DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.SubContent></DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="menu-item"><UserRound size={16} />账号信息<MenuChevron className="menu-chevron" size={14} /></DropdownMenu.SubTrigger>
                <DropdownMenu.Portal><DropdownMenu.SubContent className="menu-content account-info-menu" sideOffset={6}>
                  <DropdownMenu.Label className="account-info"><span>用户名</span><strong>{user?.username}</strong><span>注册时间</span><strong>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-CN") : "—"}</strong></DropdownMenu.Label>
                </DropdownMenu.SubContent></DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" onSelect={() => setModal("devices")}><Laptop size={16} />登录设备</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={loggingOut} onSelect={() => void logout()}><LogOut size={14} />退出登录</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        </footer>
      </aside>

      {!isHome && <section className="pages-panel" id="pages-panel">
        <div className="panel-heading pages-panel-heading">
          <button className="icon-button sidebar-toggle" title={settings.sidebarCollapsed ? "显示工作区侧栏" : "隐藏工作区侧栏"} aria-label={settings.sidebarCollapsed ? "显示工作区侧栏" : "隐藏工作区侧栏"} onClick={() => void saveSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}>
            {settings.sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>

          <div className="panel-heading-actions">
            <button className="icon-button" title="新建页面" aria-label="新建页面" onClick={() => void createPage()}><FilePlus2 size={17} /></button>
            <button className="icon-button mobile-pages-close" title="关闭页面列表" aria-label="关闭页面列表" onClick={() => setShowPages(false)}><X size={16} /></button>
          </div>
        </div>
        <div className="sidebar-brand-divider pages-panel-divider" role="separator" aria-orientation="horizontal" />
        {!selectedNotebook ? <div className="empty-state"><div><strong>选择一个笔记本</strong><p>从左侧选择笔记本<br />查看或创建页面</p></div></div> :
          <ScrollArea className="pages-panel-scroll" label="页面列表">
            <button className="notebook-cover-card" type="button" onClick={() => void editNotebook(selectedNotebook)} title="编辑封面">
              {selectedNotebook.coverAssetId
                ? <Image className="notebook-cover-large" src={`/uploads/notes/${selectedNotebook.coverAssetId}`} alt={`${selectedNotebook.title}封面`} width={640} height={360} unoptimized />
                : <span className="notebook-cover-placeholder"><ImageIcon size={27} /><span>添加笔记本封面</span></span>}
              <span className="cover-edit-label">编辑封面</span>
            </button>
            <div className="notebook-panel-summary">
              <strong className="text-ui-body" title={selectedNotebook.title}>{selectedNotebook.title}</strong>
              <span>{pages.length} 个页面</span>
            </div>

            <div className="page-list-heading">
              <span>页面</span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="page-sort-control" aria-label="页面排序方式">
                    <ArrowDownWideNarrow size={14} />
                    <span>{pageSortOptions.find((option) => option.value === sortMode)?.label}</span>
                    <ChevronDown size={13} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="menu-content page-sort-menu" side="bottom" align="end" sideOffset={6} avoidCollisions={false}>
                    <DropdownMenu.RadioGroup value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                      {pageSortOptions.map(({ value, label }) => <DropdownMenu.RadioItem className="menu-item settings-radio-item" key={value} value={value}>
                        {label}<DropdownMenu.ItemIndicator className="menu-check"><Check size={14} /></DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>)}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {visiblePages.length === 0 ? <div className="empty-state page-empty-state"><div><strong>这里还没有页面</strong><p>点击右上角创建一篇新笔记</p></div></div> :
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(event) => setDraggingPage(String(event.active.id))} onDragEnd={(event) => { setDraggingPage(null); void reorderPages(event); }} onDragCancel={() => setDraggingPage(null)}>
                <SortableContext items={visiblePages.map((page) => page.id)} strategy={verticalListSortingStrategy}>
                  <div className="page-list">
                    {visiblePages.map((page) => <SortablePageRow
                      key={page.id}
                      page={page}
                      active={selectedPage?.id === page.id}
                      disabled={sortMode !== "manual"}
                      onOpen={() => void openPage(page.id)}
                      onRename={() => void renamePage(page)}
                      onDelete={() => void removePage(page)}
                      onPin={() => void togglePin("page", page.id, Boolean(page.pinnedAt))}
                    />)}
                  </div>
                </SortableContext>
                <DragOverlay>{draggingPage ? <div className="page-row page-row-overlay">{pages.find((page) => page.id === draggingPage)?.title}</div> : null}</DragOverlay>
              </DndContext>}
          </ScrollArea>}
        <PanelResizer width={pagesPanelWidth} onChange={setPagesPanelWidth} />
      </section>}

      <section className="editor-panel">
        {(knowledgeOpen || trashOpen) && <header className="editor-topbar workspace-view-topbar"><button className="icon-button mobile-nav-toggle" aria-label="显示文件夹" onClick={() => setShowSidebar(true)}><Folder size={16} /></button><button className="button-subtle" onClick={() => { if (trashOpen) setTrashOpen(false); else setKnowledgeOpen(false); }}><ArrowLeft size={16} />返回笔记本</button></header>}
        {trashOpen ? (      <div className="trash-workspace">
        <section className="trash-page" aria-labelledby="trash-title">
          <header className="modal-header">
            <h1 id="trash-title" className="text-ui-title">垃圾箱</h1>
            <div className="trash-header-actions">
              {trashItems.length > 0 && <button className="button-subtle destructive" type="button" onClick={() => void emptyTrash()}>清空垃圾箱</button>}
              <button className="icon-button" type="button" aria-label="关闭垃圾箱" onClick={() => setTrashOpen(false)}><X size={15} /></button>
            </div>
          </header>
          <div className="trash-filters"><p>已删除的内容保留 7 天</p><input className="control-input" aria-label="搜索垃圾箱" placeholder="搜索垃圾箱" value={trashQuery} onChange={(event) => setTrashQuery(event.target.value)} /><select className="control-input" aria-label="垃圾箱类型" value={trashType} onChange={(event) => setTrashType(event.target.value)}><option value="all">全部类型</option><option value="notebook">笔记本</option><option value="page">页面</option></select></div>
          <div className="trash-list">
            {!trashItems.length ? <p className="status-line">垃圾箱为空</p> : trashItems.filter((item) => (trashType === "all" || item.type === trashType) && item.title.toLowerCase().includes(trashQuery.toLowerCase())).map((item) => <div className="trash-item" key={`${item.type}:${item.id}`}>
              <div className="trash-item-info">
                {item.type === "notebook" ? <BookOpen size={16} /> : <FileText size={16} />}
                <div><strong>{item.title}</strong><span>{item.originalLocation}</span><small>删除于 {new Date(item.deletedAt).toLocaleString("zh-CN")} · {item.remainingDays} 天后永久删除</small></div>
              </div>
              <button className="button-outline" type="button" onClick={() => void restoreTrashItem(item)}>恢复</button>
              <button className="icon-button destructive" type="button" aria-label={`永久删除${item.title}`} title="永久删除" onClick={() => void permanentlyDeleteTrashItem(item)}><Trash2 size={14} /></button>
            </div>)}
          </div>
        </section>
      </div>) : <>

        {!selectedPage && !knowledgeOpen && <header className="editor-topbar editor-empty-topbar">
          <button className="icon-button mobile-nav-toggle" title="显示文件夹" aria-label="显示文件夹" onClick={() => setShowSidebar(true)}><Folder size={16} /></button>
          {!isHome && <button className="icon-button mobile-nav-toggle" title="显示页面列表" aria-label="显示页面列表" onClick={() => setShowPages(true)}><NotebookPen size={16} /></button>}
          <div className="empty-editor-actions">
            <button className="button-subtle header-action" type="button" onClick={openGlobalSearch}><Search size={15} />全局搜索</button>
          </div>
        </header>}
        {knowledgeOpen ? <KnowledgeLibrary onImport={(file) => void importCnf(file)} /> : !selectedNotebook ? <NotebookHome notebooks={notebooks} importing={transferring} onOpen={(item) => { const notebook = notebooks.find((book) => book.id === item.id); if (notebook) void openNotebook(notebook); }} onCreate={() => { const folder = folders.find((item) => item.isDefault); if (folder) void createNotebook(folder); }} onImport={(file) => void importCnf(file)} /> : !selectedPage ? <div className="empty-state"><div><strong>{selectedNotebook ? "选择或创建页面" : "尚未选择笔记本"}</strong><p>{selectedNotebook ? "从页面列表中打开一篇笔记，或创建新页面" : "点击左侧新建笔记本开始记录"}</p>
          {selectedNotebook && <button className="button-primary" style={{ marginTop: 15 }} onClick={() => void createPage()}><Plus size={14} />新建页面</button>}
          {!selectedNotebook && <button className="button-primary" style={{ marginTop: 15 }} onClick={() => {
            const folder = folders.find((item) => item.isDefault);
            if (folder) void createNotebook(folder);
          }}><Plus size={14} />新建笔记本</button>}
        </div></div> : <PageEditor
          key={`${selectedPage.id}:${editorReset}`}
          page={selectedPage}
          autoSaveMode={settings.autoSaveMode}
          breadcrumb={{
            folder: folders.find((item) => item.id === selectedNotebook?.folderId)?.name ?? "",
            notebook: selectedNotebook?.title ?? "",
            page: selectedPage.title
          }}
          onNavigateFolder={() => {
            if (selectedNotebook) navigateFolder(selectedNotebook.folderId);
          }}
          onNavigateNotebook={() => { if (selectedNotebook) void openNotebook(selectedNotebook); }}
          onOpenSidebar={() => setShowSidebar(true)}
          onOpenPages={() => setShowPages(true)}
          onSaved={(page) => updateSavedPage(page)}
          onOpenHistory={() => void openHistory()}
          onExport={() => {
            void flushPageEdits(selectedPage.id).then(() => { setExportScope("page"); setModal("export"); })
              .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法保存导出内容"));
          }}
          onGlobalSearch={openGlobalSearch}
        />}
        </>}
        <span className="app-version" aria-label="应用版本">v {appVersion}</span>
      </section>

      <Dialog.Root open={editingNotebook !== null} onOpenChange={(open) => { if (!open && !coverSavingRef.current) { setEditingNotebook(null); setEditCoverFile(null); setEditCoverPreview(""); } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="form-dialog-overlay" />
          <Dialog.Content className="form-dialog-content notebook-edit-dialog" onEscapeKeyDown={(event) => { if (coverSavingRef.current) event.preventDefault(); }} onInteractOutside={(event) => { if (coverSavingRef.current) event.preventDefault(); }}>
          <header className="modal-header"><Dialog.Title>编辑封面</Dialog.Title><Dialog.Close className="icon-button" type="button" aria-label="关闭" disabled={coverSaving}><X size={15} /></Dialog.Close></header>
          <div className="modal-body">
            <div className="cover-dialog-label">笔记本封面</div>
            <div className="cover-dialog-preview">
              {editCoverPreview
                ? <Image src={editCoverPreview} alt="所选封面预览" width={640} height={360} unoptimized />
                : editingNotebook?.coverAssetId && !coverRemoved
                  ? <Image src={`/uploads/notes/${editingNotebook.coverAssetId}`} alt={`${editingNotebook.title}当前封面`} width={640} height={360} unoptimized />
                  : <div className="notebook-cover-placeholder"><ImageIcon size={25} /><span>默认封面</span></div>}
            </div>
            <div className="cover-dialog-actions">
              <input ref={coverInputRef} className="cover-file-input" type="file" tabIndex={-1} aria-label="选择封面图片" accept="image/jpeg,image/png,image/webp,image/gif" disabled={coverSaving} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size === 0) {
                  setError("请选择有效的 JPG、PNG、WebP 或 GIF 图片");
                  return;
                }
                if (file.size > 10 * 1024 * 1024) { setError("封面图片不能超过 10 MB"); return; }
                setCropFile(file);
              }} />
              <button className="button-outline cover-file-button" type="button" disabled={coverSaving} onClick={() => coverInputRef.current?.click()}>
                {editCoverFile ? "重新选择" : "上传封面"}
              </button>
              {(editCoverFile || (editingNotebook?.coverAssetId && !coverRemoved)) && <button className="button-subtle cover-remove-button" type="button" disabled={coverSaving} onClick={() => { setEditCoverFile(null); setEditCoverPreview(""); setCoverRemoved(true); }}><Trash2 size={14} />移除封面</button>}
            </div>
            <Dialog.Description className="cover-upload-description">支持 JPG、PNG、WebP、GIF，裁剪确认后点击保存生效。</Dialog.Description>
            <p className="cover-file-status" role="status">{editCoverFile?.name ?? (coverRemoved ? "保存后移除当前封面" : "")}</p>
          </div>
          <footer className="form-dialog-actions">
            <Dialog.Close className="button-outline" type="button" disabled={coverSaving}>取消</Dialog.Close>
            <button className="button-primary" type="button" disabled={coverSaving || (!editCoverFile && !coverRemoved)} onClick={() => void saveNotebookEdits()}>{coverSaving ? "保存中…" : "保存"}</button>
          </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {cropFile && <CoverCropDialog file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(file) => { setEditCoverFile(file); setEditCoverPreview(URL.createObjectURL(file)); setCoverRemoved(false); setCropFile(null); }} />}
      {modal === "devices" && <DevicesModal onClose={() => setModal(null)} onLogout={() => void logout()} />}
      {modal === "history" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal-card">
          <header className="modal-header"><strong>版本历史</strong><div>{snapshots.length > 0 && <button className="button-subtle" onClick={() => void clearHistory()}>清空全部</button>}<button className="icon-button" onClick={() => setModal(null)}><X size={15} /></button></div></header>
          <div className="modal-body">
            {preview && <div className="admin-section" style={{ marginBottom: 14 }}>
              <strong>{preview.title}</strong><pre style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", color: "#888" }}>{plainText(preview.content).slice(0, 1400) || "空白页面"}</pre>
            </div>}
            {!snapshots.length ? <p className="status-line">还没有可用的历史版本</p> : snapshots.map((snapshot) => <div className="history-item" key={snapshot.id}>
              <div className="history-item-info"><strong>{formatRelative(snapshot.createdAt)}</strong><span>{new Date(snapshot.createdAt).toLocaleString("zh-CN")}</span></div>
              <button className="button-outline" onClick={() => void previewSnapshot(snapshot)}>预览</button>
              <button className="button-outline" onClick={() => void restoreSnapshot(snapshot)}>恢复</button>
              <button className="icon-button" aria-label="删除历史版本" onClick={() => void deleteSnapshot(snapshot)}><Trash2 size={14} /></button>
            </div>)}
          </div>
        </section>
      </div>}
      {modal === "export" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <header className="modal-header"><strong id="export-title">选择导出范围</strong><button className="icon-button" type="button" aria-label="关闭" onClick={() => setModal(null)}><X size={15} /></button></header>
          <div className="modal-body export-options">
            <label><input type="radio" name="export-scope" checked={exportScope === "page"} onChange={() => setExportScope("page")} />当前页面</label>
            <label><input type="radio" name="export-scope" checked={exportScope === "notebook"} onChange={() => setExportScope("notebook")} />当前笔记本</label>
            <div className="form-dialog-actions export-format-actions">
              <button className="button-primary" type="button" onClick={exportSelection}>打印 / 保存为 PDF</button>
          <button className="button-outline" type="button" onClick={() => { if (selectedPage) void flushPageEdits(selectedPage.id).then(() => downloadKnowledgeFile(exportScope === "page" ? `/api/pages/${selectedPage.id}/cnf` : `/api/notebooks/${selectedNotebook?.id}/cnf`, `${exportScope === "page" ? selectedPage.title : selectedNotebook?.title}.cnf`)).then(() => setModal(null)).catch((error: unknown) => setError(error instanceof Error ? error.message : "导出失败")); }}>导出原生文件 (.cnf)</button>
              <button className="button-outline" type="button" onClick={() => setModal(null)}>取消</button>
            </div>
          </div>
        </section>
      </div>}
      {modal === "global-search" && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="modal-card global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
          <header className="modal-header"><strong id="global-search-title">全局搜索</strong><button className="icon-button" type="button" aria-label="关闭搜索" onClick={() => setModal(null)}><X size={15} /></button></header>
          <div className="global-search-input"><Search size={17} /><input autoFocus value={globalQuery} onChange={(event) => {
            const value = event.target.value;
            setGlobalQuery(value);
            if (!value.trim()) { setGlobalResults([]); setGlobalSearchError(""); setGlobalSearchBusy(false); }
          }} placeholder="搜索文件夹、笔记本、页面和正文..." aria-label="全局搜索词" /></div>
          <div className="modal-body global-search-results" aria-live="polite">
            <div className="global-search-status" role="status">
              {globalSearchError ? <span className="form-error">{globalSearchError}</span> : globalSearchBusy ? "正在搜索..." : globalQuery.trim() && !globalResults.length ? "没有找到匹配内容" : ""}
            </div>
            {globalResults.map((result) => <button className="global-search-result" type="button" key={`${result.type}:${result.id}`} onClick={() => void openSearchResult(result)}>
              <span className="global-search-result-icon">{result.type === "folder" ? <Folder size={16} /> : result.type === "notebook" ? <BookOpen size={16} /> : <FileText size={16} />}</span>
              <span className="global-search-result-copy">
                <strong>{result.title}</strong>
                <small>{result.type === "folder" ? "文件夹" : result.type === "notebook" ? `${result.folderName} · 笔记本` : `${result.folderName} / ${result.notebookTitle}`}</small>
                {result.summary && <span>{renderHighlightedText(result.summary, globalQuery)}</span>}
                {result.updatedAt && <small>更新于 {formatRelative(result.updatedAt)}</small>}
              </span>
            </button>)}
          </div>
        </section>
      </div>}

    </main>
  );
}

function renderHighlightedText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "giu")).map((part, index) =>
    part.toLocaleLowerCase() === needle.toLocaleLowerCase()
      ? <mark key={index}>{part}</mark>
      : <span key={index}>{part}</span>
  );
}

function SortablePageRow({ page, active, disabled, onOpen, onRename, onDelete, onPin }: {
  page: PageItem;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onPin: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: page.id, disabled });
  return <article
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`page-row ${active ? "active" : ""} ${isDragging ? "dragging" : ""} ${isOver && !isDragging ? "drag-over" : ""}`}
  >
    <button
      className="page-drag-handle"
      type="button"
      title={disabled ? "切换到手动排序后可拖动" : "拖动以排序"}
      aria-label={`拖动页面：${page.title}`}
      disabled={disabled}
      {...attributes}
      {...listeners}
    ><GripVertical size={17} /></button>
    <button className="page-row-open" type="button" onClick={onOpen}>
      <span className="page-row-title" title={page.title}>{page.title}</span>
      <span className="page-summary">{page.summary || "空白页面"}</span>
      <span className="page-row-time">{formatRelative(page.updatedAt)}</span>
    </button>
    <div className="page-actions">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button className="icon-button" type="button" title="页面操作" aria-label={`${page.title} 操作`}><Ellipsis size={15} /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
          <DropdownMenu.Item className="menu-item" onSelect={onPin}>{page.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}{page.pinnedAt ? "取消置顶" : "置顶页面"}</DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={onRename}><Pencil size={14} />重命名页面</DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item destructive" onSelect={onDelete}><Trash2 size={14} />删除页面</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  </article>;
}

function DevicesModal({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const [sessions, setSessions] = useState<{ id: string; deviceLabel: string; createdAt: string; lastActiveAt: string; current: boolean }[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const loadSessions = useCallback(async () => {
    try {
      const result = await requestJson<{ sessions: typeof sessions }>("/api/auth/sessions");
      setSessions(result.sessions);
      setSessionError("");
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : "无法读取登录会话");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadSessions(); }, 0);
    return () => clearTimeout(timer);
  }, [loadSessions]);

  async function revokeSession(sessionId: string, current: boolean) {
    setSessionBusy(true);
    try {
      await requestJson(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
      if (current) onLogout();
      else await loadSessions();
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : "无法退出该会话");
    } finally {
      setSessionBusy(false);
    }
  }

  async function revokeOtherSessions() {
    setSessionBusy(true);
    try {
      await requestJson("/api/auth/sessions", { method: "DELETE" });
      await loadSessions();
    } catch (cause) {
      setSessionError(cause instanceof Error ? cause.message : "无法退出其他会话");
    } finally {
      setSessionBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="devices-title">
      <header className="modal-header"><strong id="devices-title">登录设备</strong><button className="icon-button" aria-label="关闭登录设备" onClick={onClose}><X size={15} /></button></header>
      <div className="modal-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 18 }}>
          <label className="field-label" style={{ margin: 0 }}>登录设备 · {sessions.length} 个有效会话</label>
          {sessions.length > 1 && <button className="button-subtle" type="button" disabled={sessionBusy} onClick={() => void revokeOtherSessions()}>退出其他设备</button>}
        </div>
        {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
        <div className="admin-section" style={{ marginTop: 8 }}>
          {!sessions.length ? <div className="status-line">没有活跃会话</div> : sessions.map((session) => <div key={session.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid hsl(var(--border))" }}>
            <Laptop size={16} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{session.deviceLabel}{session.current && <span className="current-device-badge">当前设备</span>}</div>
              <div className="status-line">最近活跃：{formatRelative(session.lastActiveAt)}</div>
            </div>
            <button className="button-subtle" type="button" disabled={sessionBusy} onClick={() => void revokeSession(session.id, session.current)}>{session.current ? "退出" : "退出此设备"}</button>
          </div>)}
        </div>
      </div>
      <footer className="modal-footer"><button className="button-primary" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

function plainText(content: string) {
  try {
    const visit = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const item = node as { text?: string; content?: unknown[] };
      return (item.text ?? "") + (item.content ?? []).map(visit).join("");
    };
    return visit(JSON.parse(content));
  } catch { return ""; }
}

