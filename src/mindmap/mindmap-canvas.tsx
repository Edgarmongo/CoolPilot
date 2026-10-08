"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import localforage from "localforage";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileCode,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Move,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Plus,
  Redo2,
  RefreshCw,
  Sparkles,
  Trash,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { parseMindMapDocument, serializeMindMapDocument } from "./mindmap-document";
import { useMindMapHistory } from "./mindmap-history";
import {
  computeMindMapLayout,
  type MindMapLayout,
  type MindMapMeasure,
} from "./mindmap-layout";
import { markdownToMindMap, mindMapToMarkdown } from "./mindmap-markdown";
import { createMindMapMeasure, MINDMAP_FONT_FAMILY } from "./mindmap-measure";
import {
  addChildNode,
  addSiblingNode,
  canMoveNode,
  createMindMapNode,
  findNode,
  findParent,
  flattenNodes,
  moveNode,
  removeNode,
  toggleCollapsed,
  updateNode,
} from "./mindmap-model";
import { buildMindMapSvg } from "./mindmap-svg";
import {
  defaultMindMapThemeId,
  getMindMapTheme,
  mindMapDepthFill,
  mindMapThemes,
} from "./mindmap-theme";
import type { MindMapDirection, MindMapDocument, MindMapNode, MindMapView } from "./mindmap-types";

const STORAGE_KEY = "mindmap_document";
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.2;
const CANVAS_PADDING = 60;
const ZOOM_BUTTON_CLASS =
  "grid size-7 place-items-center rounded-full text-zinc-600 transition hover:bg-sky-50 hover:text-sky-600";

localforage.config({
  name: "MeowusMindmap",
  storeName: "mindmap_store",
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

function resolveDocument(element: HTMLElement | null): Document {
  return element?.ownerDocument ?? document;
}

function resolveWindow(element: HTMLElement | null): Window & typeof globalThis {
  return (resolveDocument(element).defaultView ?? window) as Window & typeof globalThis;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildDefaultMindMap(root: string, branches: string[]): MindMapNode {
  return createMindMapNode(root, branches.map((branch) => createMindMapNode(branch)));
}

type Interaction =
  | { mode: "none" }
  | { mode: "pan"; startX: number; startY: number; originTx: number; originTy: number }
  | { mode: "drag"; id: string; startX: number; startY: number; moved: boolean };

type Notice = { tone: "success" | "error"; message: string };

type ExportKind = "json" | "markdown" | "svg" | "png";

function ExportItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-600 transition hover:bg-sky-50 hover:text-sky-700"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function MindMapCanvas() {
  const { t, locale } = useI18n();

  const defaultBranches = useMemo(
    () => [t("mmDefaultBranchOne"), t("mmDefaultBranchTwo"), t("mmDefaultBranchThree")],
    [t],
  );
  const initialRoot = useMemo(
    () => buildDefaultMindMap(t("mmDefaultRoot"), defaultBranches),
    [defaultBranches, t],
  );

  const [history, dispatch] = useMindMapHistory(initialRoot);
  const root = history.root;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [themeId, setThemeId] = useState(defaultMindMapThemeId);
  const [direction, setDirection] = useState<MindMapDirection>("balanced");
  const [view, setView] = useState<MindMapView>({ scale: 1, tx: 0, ty: 0 });
  const [showOutline, setShowOutline] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loaded, setLoaded] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const interactionRef = useRef<Interaction>({ mode: "none" });
  const fittedRef = useRef(false);
  const fitPendingRef = useRef(false);

  const rootRef = useRef(root);
  const selectedRef = useRef(selectedId);
  const editingRef = useRef(editingId);
  const draftRef = useRef(draft);
  const viewRef = useRef(view);
  const dropTargetRef = useRef(dropTargetId);

  useEffect(() => {
    rootRef.current = root;
    selectedRef.current = selectedId;
    editingRef.current = editingId;
    draftRef.current = draft;
    viewRef.current = view;
    dropTargetRef.current = dropTargetId;
  }, [root, selectedId, editingId, draft, view, dropTargetId]);

  const theme = useMemo(() => getMindMapTheme(themeId), [themeId]);

  // This canvas only renders on the client (the page imports it with `ssr: false`), so a
  // standalone text-measuring canvas can be created from the ambient document once.
  const measure = useMemo<MindMapMeasure>(() => createMindMapMeasure(resolveDocument(null)), []);

  const layout: MindMapLayout = useMemo(
    () => computeMindMapLayout(root, measure, direction),
    [root, measure, direction],
  );

  const outline = useMemo(() => flattenNodes(root), [root]);

  const commit = useCallback((next: MindMapNode) => dispatch({ type: "commit", root: next }), [dispatch]);
  const undo = useCallback(() => dispatch({ type: "undo" }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: "redo" }), [dispatch]);

  const focusCanvas = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const requestFit = useCallback(() => {
    fitPendingRef.current = true;
  }, []);

  const fitView = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const width = layout.bounds.width + CANVAS_PADDING * 2;
    const height = layout.bounds.height + CANVAS_PADDING * 2;
    const scale = clamp(Math.min(rect.width / width, rect.height / height), MIN_SCALE, 1.6);
    const centerX = layout.bounds.minX + layout.bounds.width / 2;
    const centerY = layout.bounds.minY + layout.bounds.height / 2;
    setView({
      scale,
      tx: rect.width / 2 - centerX * scale,
      ty: rect.height / 2 - centerY * scale,
    });
  }, [layout]);

  const zoomBy = useCallback((factor: number) => {
    const element = containerRef.current;
    setView((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      if (!element) return { ...current, scale };
      const rect = element.getBoundingClientRect();
      const px = rect.width / 2;
      const py = rect.height / 2;
      const ratio = scale / current.scale;
      return { scale, tx: px - ratio * (px - current.tx), ty: py - ratio * (py - current.ty) };
    });
  }, []);

  const startEdit = useCallback((id: string, initial?: string) => {
    const node = findNode(rootRef.current, id);
    if (!node) return;
    editingRef.current = id;
    setSelectedId(id);
    setEditingId(id);
    setDraft(initial ?? node.content);
  }, []);

  const finishEdit = useCallback(
    (save: boolean) => {
      const id = editingRef.current;
      if (!id) return;
      editingRef.current = null;
      setEditingId(null);
      if (!save) return;
      const value = draftRef.current.trim();
      const current = findNode(rootRef.current, id);
      if (!value || !current || current.content === value) return;
      commit(updateNode(rootRef.current, id, (node) => ({ ...node, content: value })));
    },
    [commit],
  );

  const handleNodePointerDown = useCallback(
    (event: React.PointerEvent, id: string) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      focusCanvas();
      if (editingRef.current && editingRef.current !== id) finishEdit(true);
      setSelectedId(id);
      // XMind-style: the central topic is the map's anchor, so dragging it slides
      // the whole map left/right/up/down instead of re-parenting (the root can
      // never be re-parented anyway).
      if (id === rootRef.current.id) {
        setPanning(true);
        interactionRef.current = {
          mode: "pan",
          startX: event.clientX,
          startY: event.clientY,
          originTx: viewRef.current.tx,
          originTy: viewRef.current.ty,
        };
        return;
      }
      interactionRef.current = {
        mode: "drag",
        id,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    },
    [finishEdit, focusCanvas],
  );

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      focusCanvas();
      if (editingRef.current) finishEdit(true);
      setSelectedId(null);
      setExportOpen(false);
      setPanning(true);
      interactionRef.current = {
        mode: "pan",
        startX: event.clientX,
        startY: event.clientY,
        originTx: viewRef.current.tx,
        originTy: viewRef.current.ty,
      };
    },
    [finishEdit, focusCanvas],
  );

  useEffect(() => {
    const window_ = resolveWindow(containerRef.current);
    const nodeIdFromPoint = (clientX: number, clientY: number): string | null => {
      const container = containerRef.current;
      if (!container) return null;
      const hit = resolveDocument(container).elementFromPoint(clientX, clientY);
      if (!hit || !container.contains(hit)) return null;
      const nodeElement = hit.closest("[data-mindmap-node]");
      return nodeElement?.getAttribute("data-mindmap-node") ?? null;
    };
    const handleMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction.mode === "pan") {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        setView((current) => ({ ...current, tx: interaction.originTx + dx, ty: interaction.originTy + dy }));
        return;
      }
      if (interaction.mode === "drag") {
        if (!interaction.moved) {
          if (Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) < 4) return;
          interaction.moved = true;
          setDraggingId(interaction.id);
        }
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          setDragPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }
        const target = nodeIdFromPoint(event.clientX, event.clientY);
        dropTargetRef.current = target;
        setDropTargetId(target);
      }
    };
    const handleUp = () => {
      const interaction = interactionRef.current;
      interactionRef.current = { mode: "none" };
      setPanning(false);
      if (interaction.mode !== "drag") return;
      setDraggingId(null);
      setDragPoint(null);
      const target = dropTargetRef.current;
      setDropTargetId(null);
      if (!interaction.moved || !target) return;
      const next = moveNode(rootRef.current, interaction.id, target);
      if (next !== rootRef.current) {
        commit(next);
        setSelectedId(interaction.id);
      }
    };
    window_.addEventListener("pointermove", handleMove);
    window_.addEventListener("pointerup", handleUp);
    window_.addEventListener("pointercancel", handleUp);
    return () => {
      window_.removeEventListener("pointermove", handleMove);
      window_.removeEventListener("pointerup", handleUp);
      window_.removeEventListener("pointercancel", handleUp);
    };
  }, [commit]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const ratio = scale / current.scale;
        return { scale, tx: px - ratio * (px - current.tx), ty: py - ratio * (py - current.ty) };
      });
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    const document_ = resolveDocument(containerRef.current);
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isInteractive =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A" ||
        Boolean(target?.isContentEditable);
      if (isInteractive) return;

      const meta = event.ctrlKey || event.metaKey;
      if (meta && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && (event.key === "y" || event.key === "Y")) {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      }
      if (meta && event.key === "-") {
        event.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        return;
      }
      if (meta && event.key === "0") {
        event.preventDefault();
        fitView();
        return;
      }

      if (editingRef.current) return;
      if (event.key === "Escape" && interactionRef.current.mode !== "none") {
        event.preventDefault();
        interactionRef.current = { mode: "none" };
        setDraggingId(null);
        setDropTargetId(null);
        setDragPoint(null);
        setPanning(false);
        return;
      }
      const id = selectedRef.current;
      if (!id) {
        if (event.key === "Escape") setExportOpen(false);
        return;
      }
      const current = rootRef.current;

      if (event.key === "Tab") {
        event.preventDefault();
        const result = addChildNode(current, id, t("mmNewTopic"));
        commit(result.root);
        setSelectedId(result.id);
        startEdit(result.id, "");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = addSiblingNode(current, id, t("mmNewTopic"));
        commit(result.root);
        setSelectedId(result.id);
        startEdit(result.id, "");
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (id !== current.id) {
          const parent = findParent(current, id);
          commit(removeNode(current, id));
          setSelectedId(parent?.id ?? current.id);
        }
        return;
      }
      if (event.key === "F2" || event.key === " ") {
        event.preventDefault();
        startEdit(id);
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (event.key.length === 1 && !meta && !event.altKey) {
        event.preventDefault();
        startEdit(id, event.key);
      }
    };
    document_.addEventListener("keydown", handleKeyDown);
    return () => document_.removeEventListener("keydown", handleKeyDown);
  }, [commit, fitView, redo, startEdit, t, undo, zoomBy]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await localforage.getItem<unknown>(STORAGE_KEY);
        if (cancelled || !stored) return;
        const document_ = parseMindMapDocument(stored);
        if (!document_) return;
        dispatch({ type: "reset", root: document_.root });
        setThemeId(document_.themeId);
        setDirection(document_.direction);
        setSelectedId(document_.root.id);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!loaded) return;
    if (!fittedRef.current) {
      fittedRef.current = true;
    } else if (!fitPendingRef.current) {
      return;
    }
    fitPendingRef.current = false;
    const window_ = resolveWindow(containerRef.current);
    window_.requestAnimationFrame(() => fitView());
  }, [loaded, layout, fitView]);

  useEffect(() => {
    if (!loaded) return;
    const window_ = resolveWindow(containerRef.current);
    const timer = window_.setTimeout(() => {
      const document_: MindMapDocument = { version: 1, root, themeId, direction };
      void localforage.setItem(STORAGE_KEY, document_);
    }, 400);
    return () => window_.clearTimeout(timer);
  }, [root, themeId, direction, loaded]);

  useEffect(() => {
    if (!exportOpen) return;
    const document_ = resolveDocument(containerRef.current);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-mindmap-export]")) setExportOpen(false);
    };
    document_.addEventListener("pointerdown", handlePointerDown);
    return () => document_.removeEventListener("pointerdown", handlePointerDown);
  }, [exportOpen]);

  useEffect(() => {
    if (!editingId) return;
    const input = editInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [editingId]);

  const addChildToSelected = useCallback(() => {
    const id = selectedRef.current ?? rootRef.current.id;
    const result = addChildNode(rootRef.current, id, t("mmNewTopic"));
    commit(result.root);
    setSelectedId(result.id);
    startEdit(result.id, "");
  }, [commit, startEdit, t]);

  const addSiblingToSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    const result = addSiblingNode(rootRef.current, id, t("mmNewTopic"));
    commit(result.root);
    setSelectedId(result.id);
    startEdit(result.id, "");
  }, [commit, startEdit, t]);

  const deleteSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id || id === rootRef.current.id) return;
    const parent = findParent(rootRef.current, id);
    commit(removeNode(rootRef.current, id));
    setSelectedId(parent?.id ?? rootRef.current.id);
  }, [commit]);

  const resetMap = useCallback(() => {
    const next = buildDefaultMindMap(t("mmDefaultRoot"), defaultBranches);
    dispatch({ type: "commit", root: next });
    setSelectedId(next.id);
    requestFit();
  }, [defaultBranches, dispatch, requestFit, t]);

  const toggleDirection = useCallback(() => {
    requestFit();
    setDirection((current) => (current === "balanced" ? "right" : "balanced"));
  }, [requestFit]);

  const generateFromAi = useCallback(async () => {
    const topic = aiTopic.trim();
    if (!topic || aiLoading) return;
    setAiLoading(true);
    setNotice(null);
    try {
      const data = await apiPost<{ markdown: string }>("/api/content/mindmap", { topic });
      const next = markdownToMindMap(data.markdown, topic);
      dispatch({ type: "commit", root: next });
      setSelectedId(next.id);
      requestFit();
      setNotice({ tone: "success", message: t("mmAiDone") });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : t("mmAiError") });
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, aiTopic, dispatch, requestFit, t]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const reader = new (resolveWindow(containerRef.current).FileReader)();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        if (text.trim().startsWith("{") || file.name.toLowerCase().endsWith(".json")) {
          const document_ = parseMindMapDocument(text.trim());
          if (!document_) {
            setNotice({ tone: "error", message: t("mmImportInvalid") });
            return;
          }
          dispatch({ type: "reset", root: document_.root });
          setThemeId(document_.themeId);
          setDirection(document_.direction);
          setSelectedId(document_.root.id);
        } else {
          const next = markdownToMindMap(text, t("mmDefaultRoot"));
          dispatch({ type: "commit", root: next });
          setSelectedId(next.id);
        }
        requestFit();
        setNotice({ tone: "success", message: t("mmImportDone") });
      };
      reader.readAsText(file);
    },
    [dispatch, requestFit, t],
  );

  const downloadBlob = useCallback((filename: string, blob: Blob) => {
    const document_ = resolveDocument(containerRef.current);
    const window_ = resolveWindow(containerRef.current);
    const url = window_.URL.createObjectURL(blob);
    const anchor = document_.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document_.body.append(anchor);
    anchor.click();
    anchor.remove();
    window_.setTimeout(() => window_.URL.revokeObjectURL(url), 0);
  }, []);

  const exportAs = useCallback(
    async (kind: ExportKind) => {
      setExportOpen(false);
      try {
        if (kind === "json") {
          const document_: MindMapDocument = { version: 1, root: rootRef.current, themeId, direction };
          downloadBlob("mindmap.json", new Blob([serializeMindMapDocument(document_)], { type: "application/json" }));
          return;
        }
        if (kind === "markdown") {
          downloadBlob("mindmap.md", new Blob([mindMapToMarkdown(rootRef.current)], { type: "text/markdown" }));
          return;
        }
        const svg = buildMindMapSvg(layout, theme);
        if (kind === "svg") {
          downloadBlob("mindmap.svg", new Blob([svg.markup], { type: "image/svg+xml;charset=utf-8" }));
          return;
        }
        const document_ = resolveDocument(containerRef.current);
        const window_ = resolveWindow(containerRef.current);
        const svgUrl = window_.URL.createObjectURL(
          new Blob([svg.markup], { type: "image/svg+xml;charset=utf-8" }),
        );
        const image = new window_.Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("mindmap image render failed"));
          image.src = svgUrl;
        });
        const scale = 2;
        const canvas = document_.createElement("canvas");
        canvas.width = Math.max(1, Math.round(svg.width * scale));
        canvas.height = Math.max(1, Math.round(svg.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas 2d context unavailable");
        context.scale(scale, scale);
        context.drawImage(image, 0, 0);
        window_.URL.revokeObjectURL(svgUrl);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((out) => resolve(out), "image/png"));
        if (blob) downloadBlob("mindmap.png", blob);
      } catch {
        setNotice({ tone: "error", message: t("mmExportFailed") });
      }
    },
    [direction, downloadBlob, layout, t, theme, themeId],
  );

  const svgLeft = layout.bounds.minX - CANVAS_PADDING;
  const svgTop = layout.bounds.minY - CANVAS_PADDING;
  const svgWidth = layout.bounds.width + CANVAS_PADDING * 2;
  const svgHeight = layout.bounds.height + CANVAS_PADDING * 2;

  const draggingNode = draggingId ? findNode(root, draggingId) : null;
  const draggingLayoutNode = draggingId
    ? (layout.nodes.find((node) => node.id === draggingId) ?? null)
    : null;
  const dropTargetValid = Boolean(draggingId && dropTargetId && canMoveNode(root, draggingId, dropTargetId));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-100 bg-white px-3 py-2 shadow-[0_12px_28px_rgba(37,99,235,0.06)]">
        <div className="flex items-center gap-2 pr-2">
          <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
            <Network className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-zinc-950">{t("mmTitle")}</div>
            <div className="text-[11px] text-zinc-400">{t("mmNodeCount", { count: outline.length })}</div>
          </div>
        </div>
        <span className="hidden h-6 w-px bg-sky-100 sm:block" />
        <Button variant="ghost" size="sm" onClick={() => setShowOutline((value) => !value)} title={t("mmOutline")}>
          {showOutline ? <PanelLeftClose /> : <PanelLeftOpen />}
          <span className="hidden lg:inline">{t("mmOutline")}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={resetMap}>
          <RefreshCw />
          {t("mmNew")}
        </Button>
        <Button variant="ghost" size="sm" disabled={!history.past.length} onClick={undo} title={t("mmUndo")}>
          <Undo2 />
        </Button>
        <Button variant="ghost" size="sm" disabled={!history.future.length} onClick={redo} title={t("mmRedo")}>
          <Redo2 />
        </Button>
        <Button variant="outline" size="sm" onClick={addChildToSelected}>
          <Plus />
          {t("mmAddChild")}
        </Button>
        <Button variant="outline" size="sm" disabled={!selectedId} onClick={addSiblingToSelected}>
          {t("mmAddSibling")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedId || selectedId === root.id}
          onClick={deleteSelected}
        >
          <Trash />
          {t("mmDelete")}
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-sky-100 bg-white pl-3">
            <Sparkles className="size-4 text-violet-500" />
            <input
              value={aiTopic}
              onChange={(event) => setAiTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void generateFromAi();
              }}
              placeholder={t("mmAiPlaceholder")}
              className="h-9 w-40 bg-transparent text-xs outline-none placeholder:text-zinc-400 sm:w-52"
            />
            <Button size="sm" loading={aiLoading} onClick={() => void generateFromAi()}>
              {t("mmAiGenerate")}
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload />
            {t("mmImport")}
          </Button>
          <div className="relative" data-mindmap-export>
            <Button variant="outline" size="sm" onClick={() => setExportOpen((value) => !value)}>
              <Download />
              {t("mmExport")}
              <ChevronDown />
            </Button>
            {exportOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-2xl border border-sky-100 bg-white py-1 shadow-lg">
                <ExportItem icon={<FileCode className="size-4" />} label={t("mmExportJson")} onClick={() => void exportAs("json")} />
                <ExportItem icon={<FileText className="size-4" />} label={t("mmExportMarkdown")} onClick={() => void exportAs("markdown")} />
                <ExportItem icon={<FileText className="size-4" />} label={t("mmExportSvg")} onClick={() => void exportAs("svg")} />
                <ExportItem icon={<ImageIcon className="size-4" />} label={t("mmExportPng")} onClick={() => void exportAs("png")} />
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1 rounded-full border border-sky-100 bg-white pl-2">
            <Palette className="size-4 text-sky-500" />
            <select
              value={themeId}
              onChange={(event) => setThemeId(event.target.value)}
              className="h-9 bg-transparent pr-2 text-xs outline-none"
              title={t("mmTheme")}
            >
              {mindMapThemes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name[locale === "en" ? "en" : "zh"]}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" size="sm" onClick={toggleDirection} title={t("mmDirection")}>
            <Move />
            {direction === "balanced" ? t("mmDirectionBalanced") : t("mmDirectionRight")}
          </Button>
        </div>
      </div>

      {notice ? (
        <div
          className={cn(
            "flex items-center justify-between rounded-2xl border px-4 py-2 text-xs",
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} className="ml-4 font-bold opacity-70 transition hover:opacity-100">
            ×
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        {showOutline ? (
          <aside className="flex w-56 shrink-0 flex-col overflow-hidden rounded-2xl border border-sky-100 bg-white">
            <div className="flex items-center justify-between border-b border-sky-100 px-3 py-2">
              <span className="text-xs font-semibold text-zinc-700">{t("mmOutline")}</span>
              <button
                type="button"
                onClick={addChildToSelected}
                className="grid size-6 place-items-center rounded-lg text-zinc-500 transition hover:bg-sky-50 hover:text-sky-600"
                title={t("mmAddChild")}
              >
                <Plus className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {outline.map(({ node, depth }) => (
                <div key={node.id} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      if (node.children.length) commit(toggleCollapsed(root, node.id));
                    }}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded text-zinc-400",
                      node.children.length ? "hover:text-sky-600" : "invisible",
                    )}
                  >
                    {node.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedId(node.id)}
                    onDoubleClick={() => startEdit(node.id)}
                    style={{ paddingLeft: 6 + depth * 10 }}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-lg py-1 pr-2 text-left text-xs",
                      node.id === selectedId ? "bg-sky-50 text-sky-700" : "text-zinc-600 hover:bg-zinc-50",
                    )}
                  >
                    {node.content}
                  </button>
                </div>
              ))}
            </div>
          </aside>
        ) : null}

        <div
          ref={containerRef}
          tabIndex={-1}
          onPointerDown={handleBackgroundPointerDown}
          className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-2xl border border-sky-100 outline-none"
          style={{
            backgroundColor: theme.background,
            backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.35) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            cursor: panning || draggingId ? "grabbing" : "grab",
          }}
        >
          {!loaded ? (
            <div className="grid h-full place-items-center text-sm text-zinc-400">{t("mmLoading")}</div>
          ) : (
            <>
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
              >
                <svg
                  className="pointer-events-none absolute"
                  style={{ left: svgLeft, top: svgTop }}
                  width={svgWidth}
                  height={svgHeight}
                  viewBox={`${svgLeft} ${svgTop} ${svgWidth} ${svgHeight}`}
                >
                  {layout.links.map((link) => (
                    <path
                      key={link.id}
                      d={link.path}
                      fill="none"
                      stroke={theme.linkStroke}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  ))}
                </svg>
                {layout.nodes.map((node) => {
                  const isRoot = node.depth === 0;
                  const isSelected = node.id === selectedId;
                  const isDragging = node.id === draggingId;
                  const isDropTarget = dropTargetValid && node.id === dropTargetId;
                  const isDropReject = !dropTargetValid && !isDragging && node.id === dropTargetId;
                  const isEditing = node.id === editingId;
                  return (
                    <div
                      key={node.id}
                      data-mindmap-node={node.id}
                      onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                      onDoubleClick={() => startEdit(node.id)}
                      className={cn(
                        "absolute flex items-center justify-center rounded-[10px] border text-center shadow-sm transition-[box-shadow,opacity]",
                        isSelected && !isDragging && "ring-2 ring-sky-400 ring-offset-1",
                        isDropTarget && "ring-2 ring-emerald-400 ring-offset-1",
                        isDropReject && "ring-2 ring-rose-300 ring-offset-1",
                        isDragging && "opacity-40",
                        node.hasHiddenChildren && "pr-6",
                      )}
                      style={{
                        left: node.x,
                        top: node.y,
                        width: node.width,
                        height: node.height,
                        backgroundColor: isRoot ? theme.rootFill : mindMapDepthFill(theme, node.depth),
                        borderColor: isDropTarget
                          ? "#34d399"
                          : isDropReject
                            ? "#fda4af"
                            : isRoot
                              ? theme.rootStroke
                              : theme.nodeStroke,
                        borderStyle: isDragging ? "dashed" : undefined,
                        color: isRoot ? theme.rootText : theme.nodeText,
                        fontFamily: MINDMAP_FONT_FAMILY,
                        fontSize: isRoot ? 15 : 14,
                        cursor: isRoot ? (panning ? "grabbing" : "grab") : isDragging ? "grabbing" : "pointer",
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={draft}
                          onChange={(event) => {
                            draftRef.current = event.target.value;
                            setDraft(event.target.value);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onBlur={() => finishEdit(true)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              finishEdit(true);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              finishEdit(false);
                            }
                          }}
                          className="h-full w-full rounded-[9px] border border-sky-400 bg-white px-2 text-center text-[13px] text-zinc-900 outline-none"
                        />
                      ) : (
                        <span className="pointer-events-none line-clamp-2 px-1">
                          {node.content}
                        </span>
                      )}
                      {node.hasHiddenChildren ? (
                        <span
                          className="pointer-events-none absolute -right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: theme.badgeBackground, color: theme.badgeText }}
                        >
                          {node.childCount}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {draggingNode && draggingLayoutNode && dragPoint ? (
                <div
                  className="pointer-events-none absolute z-20 flex items-center justify-center rounded-[10px] border shadow-xl"
                  style={{
                    left: dragPoint.x,
                    top: dragPoint.y,
                    width: draggingLayoutNode.width * view.scale,
                    height: draggingLayoutNode.height * view.scale,
                    transform: "translate(-50%, -50%)",
                    borderRadius: 10 * view.scale,
                    backgroundColor:
                      draggingLayoutNode.depth === 0
                        ? theme.rootFill
                        : mindMapDepthFill(theme, draggingLayoutNode.depth),
                    borderColor: draggingLayoutNode.depth === 0 ? theme.rootStroke : theme.nodeStroke,
                    color: draggingLayoutNode.depth === 0 ? theme.rootText : theme.nodeText,
                    fontFamily: MINDMAP_FONT_FAMILY,
                    fontSize: (draggingLayoutNode.depth === 0 ? 15 : 14) * view.scale,
                    opacity: 0.95,
                  }}
                >
                  <span className="line-clamp-2 px-1">{draggingNode.content}</span>
                </div>
              ) : null}
            </>
          )}

          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-sky-100 bg-white/90 px-1 py-1 shadow-sm backdrop-blur">
            <button
              type="button"
              className={ZOOM_BUTTON_CLASS}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              title={t("mmZoomOut")}
            >
              <ZoomOut className="size-4" />
            </button>
            <span className="w-10 text-center text-[11px] tabular-nums text-zinc-500">
              {Math.round(view.scale * 100)}%
            </span>
            <button type="button" className={ZOOM_BUTTON_CLASS} onClick={() => zoomBy(ZOOM_STEP)} title={t("mmZoomIn")}>
              <ZoomIn className="size-4" />
            </button>
            <button type="button" className={ZOOM_BUTTON_CLASS} onClick={fitView} title={t("mmFit")}>
              <Maximize2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-400">
        <span>{t("mmHintSelect")}</span>
        <span>{t("mmHintEdit")}</span>
        <span>{t("mmHintMove")}</span>
        <span>{t("mmHintMoveRoot")}</span>
        <span>{t("mmHintZoom")}</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
