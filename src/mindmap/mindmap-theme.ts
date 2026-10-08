export type MindMapTheme = {
  id: string;
  name: { en: string; zh: string };
  background: string;
  rootFill: string;
  rootText: string;
  rootStroke: string;
  /** Fill colours cycled by branch depth (index 0 => root's direct children). */
  depthFills: string[];
  nodeText: string;
  nodeStroke: string;
  linkStroke: string;
  badgeBackground: string;
  badgeText: string;
};

export const mindMapThemes: MindMapTheme[] = [
  {
    id: "classic",
    name: { en: "Classic Blue", zh: "经典蓝" },
    background: "#f8fafc",
    rootFill: "#2563eb",
    rootText: "#ffffff",
    rootStroke: "#1d4ed8",
    depthFills: ["#dbeafe", "#e0f2fe", "#ede9fe", "#dcfce7", "#fee2e2"],
    nodeText: "#0f172a",
    nodeStroke: "#cbd5e1",
    linkStroke: "#94a3b8",
    badgeBackground: "#1e293b",
    badgeText: "#ffffff",
  },
  {
    id: "ocean",
    name: { en: "Ocean", zh: "海洋" },
    background: "#f0fdfa",
    rootFill: "#0d9488",
    rootText: "#ffffff",
    rootStroke: "#0f766e",
    depthFills: ["#ccfbf1", "#cffafe", "#e0f2fe", "#dbeafe"],
    nodeText: "#0f172a",
    nodeStroke: "#99f6e4",
    linkStroke: "#5eead4",
    badgeBackground: "#115e59",
    badgeText: "#ffffff",
  },
  {
    id: "forest",
    name: { en: "Forest", zh: "森林" },
    background: "#f7fee7",
    rootFill: "#16a34a",
    rootText: "#ffffff",
    rootStroke: "#15803d",
    depthFills: ["#dcfce7", "#d1fae5", "#ecfccb", "#fef9c3"],
    nodeText: "#14532d",
    nodeStroke: "#bbf7d0",
    linkStroke: "#86efac",
    badgeBackground: "#166534",
    badgeText: "#ffffff",
  },
  {
    id: "sunset",
    name: { en: "Sunset", zh: "日落" },
    background: "#fff7ed",
    rootFill: "#ea580c",
    rootText: "#ffffff",
    rootStroke: "#c2410c",
    depthFills: ["#ffedd5", "#fef3c7", "#fee2e2", "#ffe4e6"],
    nodeText: "#7c2d12",
    nodeStroke: "#fdba74",
    linkStroke: "#fdba74",
    badgeBackground: "#9a3412",
    badgeText: "#ffffff",
  },
  {
    id: "berry",
    name: { en: "Berry", zh: "莓果" },
    background: "#fdf2f8",
    rootFill: "#db2777",
    rootText: "#ffffff",
    rootStroke: "#be185d",
    depthFills: ["#fce7f3", "#fae8ff", "#e9d5ff", "#ffe4e6"],
    nodeText: "#831843",
    nodeStroke: "#f9a8d4",
    linkStroke: "#f9a8d4",
    badgeBackground: "#9d174d",
    badgeText: "#ffffff",
  },
  {
    id: "mono",
    name: { en: "Graphite", zh: "石墨" },
    background: "#f8fafc",
    rootFill: "#334155",
    rootText: "#ffffff",
    rootStroke: "#1e293b",
    depthFills: ["#e2e8f0", "#eef2f7", "#f1f5f9", "#f8fafc"],
    nodeText: "#0f172a",
    nodeStroke: "#cbd5e1",
    linkStroke: "#94a3b8",
    badgeBackground: "#0f172a",
    badgeText: "#ffffff",
  },
];

export const defaultMindMapThemeId = mindMapThemes[0].id;

export function getMindMapTheme(id: string | undefined): MindMapTheme {
  return mindMapThemes.find((theme) => theme.id === id) ?? mindMapThemes[0];
}

/** Fill colour for a non-root node at the given depth (>= 1). */
export function mindMapDepthFill(theme: MindMapTheme, depth: number): string {
  const index = Math.max(0, depth - 1) % theme.depthFills.length;
  return theme.depthFills[index];
}
