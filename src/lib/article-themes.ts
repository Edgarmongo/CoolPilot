/**
 * Typesetting themes for the article editor. The names mirror the widely used
 * WeChat themes (Default / OrangeHeart / Rainbow / Lapis / Pie / Maize /
 * Purple) so a formatted article can be pasted into an official-account editor
 * with the matching look.
 */
export const articleThemeIds = ["default", "orangeheart", "rainbow", "lapis", "pie", "maize", "purple"] as const;

export type ArticleThemeId = (typeof articleThemeIds)[number];

/**
 * Inline-safe formatting for one theme, keyed by tag name. Every value is a
 * plain CSS declaration list, so the exact same string drives both the
 * on-screen preview and the inline-styled copy/export.
 */
export type ArticleThemeStyles = {
  h1: string;
  h2: string;
  h3: string;
  p: string;
  li: string;
  strong: string;
  blockquote: string;
  img: string;
  hr: string;
  code: string;
};

export type ArticleTheme = {
  id: ArticleThemeId;
  /** Brand-ish theme name, kept untranslated on purpose. */
  label: string;
  /** Heading / accent colour. */
  accent: string;
  /** Soft accent used for blockquote borders and code backgrounds. */
  accentSoft: string;
  /** Body text colour. */
  bodyColor: string;
  /** Page background behind the rendered article. */
  background: string;
  /**
   * Heading / list / quote *shape* for this theme — not only its colour.
   * `null` only for the default theme, which deliberately adds no styling so
   * the article keeps its original rendering.
   */
  styles: ArticleThemeStyles | null;
};

type Palette = Omit<ArticleTheme, "styles">;

/** Shared spacing recipe; each theme overrides the shapes that give it its look. */
function baseStyles(palette: Palette): ArticleThemeStyles {
  const { accent, accentSoft, bodyColor } = palette;
  return {
    h1: `display:table;margin:0 auto 22px;padding:0 0 10px;border-bottom:3px solid ${accent};color:${accent};font-size:22px;font-weight:700;line-height:1.4;`,
    h2: `margin:24px 0 12px;padding:8px 14px;background:${accentSoft};border-left:5px solid ${accent};color:${accent};font-size:19px;font-weight:600;line-height:1.4;`,
    h3: `margin:20px 0 10px;padding-left:12px;border-left:3px solid ${accent};color:${accent};font-size:17px;font-weight:600;line-height:1.5;`,
    p: `margin:0 0 16px;line-height:1.9;color:${bodyColor};`,
    li: `margin:6px 0;line-height:1.9;color:${bodyColor};`,
    strong: `color:${accent};font-weight:600;`,
    blockquote: `margin:0 0 18px;padding:12px 16px;background:${accentSoft};border-left:4px solid ${accent};border-radius:0 10px 10px 0;color:${bodyColor};line-height:1.9;`,
    img: `max-width:100%;border-radius:10px;display:block;margin:18px auto;`,
    hr: `border:none;border-top:1px solid ${accentSoft};margin:24px 0;`,
    code: `padding:2px 6px;border-radius:6px;background:${accentSoft};color:${accent};font-size:14px;`,
  };
}

type ThemeSeed = Palette & {
  /** Structural overrides layered on top of the shared recipe. */
  shapes?: Partial<ArticleThemeStyles>;
};

function defineTheme(seed: ThemeSeed): ArticleTheme {
  return {
    id: seed.id,
    label: seed.label,
    accent: seed.accent,
    accentSoft: seed.accentSoft,
    bodyColor: seed.bodyColor,
    background: seed.background,
    styles: { ...baseStyles(seed), ...seed.shapes },
  };
}

const roundedImage = (radius: number) => `max-width:100%;border-radius:${radius}px;display:block;margin:18px auto;`;

export const articleThemes: ArticleTheme[] = [
  // Default carries no styles on purpose: it restores the original rendering.
  { id: "default", label: "Default", accent: "#0f172a", accentSoft: "#e2e8f0", bodyColor: "#334155", background: "#ffffff", styles: null },
  defineTheme({
    id: "orangeheart",
    label: "OrangeHeart",
    accent: "#e8590c",
    accentSoft: "#ffe8cc",
    bodyColor: "#3f3f46",
    background: "#fffaf5",
    // 居中胶囊大标题 + 右圆角浅底小标题 + 圆角引用卡片
    shapes: {
      h1: "display:table;margin:0 auto 22px;padding:8px 24px;background:#ffe8cc;border-radius:999px;color:#e8590c;font-size:22px;font-weight:700;line-height:1.4;",
      h2: "margin:24px 0 12px;padding:8px 16px;background:#fff3e6;border-left:4px solid #e8590c;border-radius:0 999px 999px 0;color:#e8590c;font-size:19px;font-weight:600;line-height:1.4;",
      h3: "margin:20px 0 10px;padding-left:12px;border-left:3px solid #f8a05a;color:#c2410c;font-size:17px;font-weight:600;line-height:1.5;",
      blockquote: "margin:0 0 18px;padding:14px 16px;background:#fff3e6;border-radius:12px;color:#9a3412;line-height:1.9;",
      img: roundedImage(14),
      hr: "border:none;border-top:1px dashed #ffd8a8;margin:24px 0;",
    },
  }),
  defineTheme({
    id: "rainbow",
    label: "Rainbow",
    accent: "#7c3aed",
    accentSoft: "#ede9fe",
    bodyColor: "#3730a3",
    background: "#f9f8ff",
    // 居中下划线大标题 + 实心胶囊小标题 + 浅底胶囊三级标题
    shapes: {
      h1: "display:table;margin:0 auto 22px;padding:0 6px 10px;border-bottom:3px solid #7c3aed;color:#5b21b6;font-size:22px;font-weight:700;line-height:1.4;text-align:center;",
      h2: "display:table;margin:26px 0 14px;padding:7px 18px;background:#7c3aed;border-radius:999px;color:#ffffff;font-size:19px;font-weight:600;line-height:1.4;",
      h3: "display:table;margin:20px 0 10px;padding:4px 12px;background:#ede9fe;border-radius:8px;color:#6d28d9;font-size:17px;font-weight:600;line-height:1.5;",
      blockquote: "margin:0 0 18px;padding:12px 16px;background:#ede9fe;border-left:4px solid #7c3aed;border-radius:10px;color:#4c1d95;line-height:1.9;",
      img: roundedImage(16),
      hr: "border:none;border-top:2px dotted #c4b5fd;margin:24px 0;",
    },
  }),
  defineTheme({
    id: "lapis",
    label: "Lapis",
    accent: "#1d4ed8",
    accentSoft: "#dbeafe",
    bodyColor: "#1e293b",
    background: "#f8fafc",
    // 居中双线大标题 + 左粗竖条小标题 + 方角引用块（稳重公文风）
    shapes: {
      h1: "display:table;margin:0 auto 22px;padding:0 8px 10px;border-bottom:3px double #1d4ed8;color:#1e40af;font-size:22px;font-weight:700;line-height:1.4;text-align:center;",
      h2: "margin:24px 0 12px;padding:8px 14px;background:#eff6ff;border-left:5px solid #1d4ed8;color:#1d4ed8;font-size:19px;font-weight:600;line-height:1.4;",
      h3: "margin:20px 0 10px;padding-left:14px;border-left:3px solid #60a5fa;color:#1e40af;font-size:17px;font-weight:600;line-height:1.5;",
      blockquote: "margin:0 0 18px;padding:12px 16px;background:#eff6ff;border-left:4px solid #1d4ed8;color:#1e3a8a;line-height:1.9;",
      img: roundedImage(8),
      hr: "border:none;border-top:1px solid #bfdbfe;margin:24px 0;",
    },
  }),
  defineTheme({
    id: "pie",
    label: "Pie",
    accent: "#0f766e",
    accentSoft: "#ccfbf1",
    bodyColor: "#134e4a",
    background: "#f5fffd",
    // 圆角描边大标题 + 无竖条圆角浅底小标题 + 虚线底三级标题 + 上下双线引用
    shapes: {
      h1: "display:table;margin:0 auto 22px;padding:8px 22px;border:2px solid #0f766e;border-radius:14px;color:#0f766e;font-size:21px;font-weight:700;line-height:1.4;",
      h2: "margin:24px 0 12px;padding:8px 14px;background:#ccfbf1;border-radius:10px;color:#0f766e;font-size:19px;font-weight:600;line-height:1.4;",
      h3: "margin:20px 0 10px;padding-bottom:6px;border-bottom:2px dashed #5eead4;color:#0f766e;font-size:17px;font-weight:600;line-height:1.5;",
      blockquote: "margin:0 0 18px;padding:14px 18px;background:#f0fdfa;border-top:2px solid #0f766e;border-bottom:2px solid #0f766e;color:#115e59;font-style:italic;line-height:1.9;",
      img: roundedImage(12),
      hr: "border:none;border-top:2px dashed #99f6e4;margin:24px 0;",
    },
  }),
  defineTheme({
    id: "maize",
    label: "Maize",
    accent: "#b45309",
    accentSoft: "#fef3c7",
    bodyColor: "#44403c",
    background: "#fffdf5",
    // 上下粗线大标题 + 左竖条浅黄小标题 + 胶囊三级标题
    shapes: {
      h1: "display:table;margin:0 auto 22px;padding:8px 20px;background:#fef3c7;border-top:3px solid #b45309;border-bottom:3px solid #b45309;color:#92400e;font-size:22px;font-weight:700;line-height:1.4;",
      h2: "margin:24px 0 12px;padding:8px 14px;background:#fffbeb;border-left:5px solid #b45309;color:#92400e;font-size:19px;font-weight:600;line-height:1.4;",
      h3: "display:table;margin:20px 0 10px;padding:4px 12px;background:#fef3c7;border-radius:6px;color:#a16207;font-size:17px;font-weight:600;line-height:1.5;",
      blockquote: "margin:0 0 18px;padding:12px 16px;background:#fffbeb;border-left:4px solid #d97706;border-radius:0 10px 10px 0;color:#78350f;line-height:1.9;",
      img: roundedImage(10),
      hr: "border:none;border-top:1px solid #fde68a;margin:24px 0;",
    },
  }),
  defineTheme({
    id: "purple",
    label: "Purple",
    accent: "#9333ea",
    accentSoft: "#f3e8ff",
    bodyColor: "#3b0764",
    background: "#fdf7ff",
    // 实心紫色胶囊大标题 + 双线竖条小标题 + 双线竖条三级标题
    shapes: {
      h1: "display:table;margin:0 auto 22px;padding:10px 28px;background:#9333ea;border-radius:999px;color:#ffffff;font-size:22px;font-weight:700;line-height:1.4;",
      h2: "margin:24px 0 12px;padding:8px 0 8px 16px;border-left:5px solid #9333ea;border-bottom:1px solid #e9d5ff;color:#7e22ce;font-size:19px;font-weight:600;line-height:1.4;",
      h3: "margin:20px 0 10px;padding-left:12px;border-left:4px double #c084fc;color:#7e22ce;font-size:17px;font-weight:600;line-height:1.5;",
      blockquote: "margin:0 0 18px;padding:14px 16px;background:#f3e8ff;border-radius:12px;color:#6b21a8;line-height:1.9;",
      img: roundedImage(16),
      hr: "border:none;border-top:2px dotted #d8b4fe;margin:24px 0;",
    },
  }),
];

export const defaultArticleThemeId: ArticleThemeId = "default";

export function isArticleThemeId(value: unknown): value is ArticleThemeId {
  return typeof value === "string" && (articleThemeIds as readonly string[]).includes(value);
}

export function findArticleTheme(id: string | undefined | null): ArticleTheme {
  return articleThemes.find((theme) => theme.id === id) ?? articleThemes[0];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True when a stored body already looks like HTML rather than plain text. */
export function looksLikeHtml(value: string) {
  return /<[a-z][\s\S]*>/i.test(value);
}

/**
 * Converts plain text (with optional `#`/`-`/`1.` line prefixes) into the HTML
 * shape the rich editor understands. Used for legacy AI-generated bodies.
 */
export function plainTextToHtml(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let listType: "ul" | "ol" | "" = "";
  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = "";
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html += `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${escapeHtml(bullet[1])}</li>`;
      continue;
    }
    const ordered = /^\d+[.)、]\s*(.*)$/.exec(line);
    if (ordered) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${escapeHtml(ordered[1])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${escapeHtml(line)}</p>`;
  }

  closeList();
  return html;
}

/** Normalises a stored body into HTML, leaving existing HTML untouched. */
export function ensureArticleHtml(value: string): string {
  if (!value.trim()) return "";
  return looksLikeHtml(value) ? value : plainTextToHtml(value);
}

const blockClosePattern = /<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|figure)>/gi;

/** Flattens rich HTML back into plain text for publishing and length counts. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(blockClosePattern, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Character count (whitespace excluded) shown as “字数” in the editor. */
export function articleCharacterCount(html: string): number {
  return htmlToPlainText(html).replace(/\s+/g, "").length;
}

/**
 * CSS applied to on-screen previews, scoped to `.article-theme`.
 *
 * The default theme deliberately emits nothing: it keeps the article at its
 * original rendering (the same Markdown-ish look content is typed or pasted in
 * with), which is what “选中 default ＝ 回到最初的版本” means.
 */
export function articleThemeCss(theme: ArticleTheme): string {
  const styles = theme.styles;
  if (!styles) return "";
  return [
    `.article-theme{color:${theme.bodyColor};font-size:16px;line-height:1.9;background:${theme.background};}`,
    `.article-theme ul,.article-theme ol{margin:0 0 16px;padding-left:22px;}`,
    `.article-theme a{color:${theme.accent};text-decoration:underline;}`,
    // One rule per tag, straight from the theme recipe — this is what makes the
    // themes differ in *shape*, not just in colour.
    ...Object.entries(styles).map(([tag, declarations]) => `.article-theme ${tag}{${declarations}}`),
  ].join("");
}

function applyTag(source: string, tag: string, style: string) {
  const pattern = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  return source.replace(pattern, (_match, attrs: string | undefined) => {
    const rest = attrs ?? "";
    const existing = /\sstyle="([^"]*)"/i.exec(rest);
    // Layer the theme on top of whatever the body already carried.
    if (existing) return `<${tag}${rest.replace(existing[0], ` style="${style}${existing[1]}"`)}>`;
    return `<${tag} style="${style}"${rest}>`;
  });
}

/**
 * Rewrites block tags with inline styles so the copy can be pasted anywhere.
 * The default theme is a no-op so the copy keeps the original markup.
 */
export function decorateArticleHtml(html: string, theme: ArticleTheme): string {
  const styles = theme.styles;
  if (!styles) return html;
  let out = applyTag(html, "h1", styles.h1);
  out = applyTag(out, "h2", styles.h2);
  out = applyTag(out, "h3", styles.h3);
  out = applyTag(out, "p", styles.p);
  out = applyTag(out, "ul", "margin:0 0 16px;padding-left:22px;");
  out = applyTag(out, "ol", "margin:0 0 16px;padding-left:22px;");
  out = applyTag(out, "li", styles.li);
  out = applyTag(out, "blockquote", styles.blockquote);
  out = applyTag(out, "strong", styles.strong);
  out = applyTag(out, "a", `color:${theme.accent};text-decoration:underline;`);
  out = applyTag(out, "code", styles.code);
  out = applyTag(out, "img", styles.img);
  out = applyTag(out, "hr", styles.hr);
  return out;
}

/** Standalone HTML snippet copied by “复制排版 HTML”. */
export function buildArticleExportHtml(html: string, theme: ArticleTheme, title = ""): string {
  const trimmedTitle = title.trim();
  // The default theme adds no styling: export the original markup untouched.
  if (!theme.styles) {
    return `${trimmedTitle ? `<h1>${escapeHtml(trimmedTitle)}</h1>` : ""}${html}`.trim();
  }
  const heading = trimmedTitle ? `<h1>${escapeHtml(trimmedTitle)}</h1>` : "";
  return [
    `<section style="background:${theme.background};padding:16px;color:${theme.bodyColor};font-size:16px;line-height:1.9;">`,
    // The title runs through the same recipe so it picks up the theme's H1 shape.
    decorateArticleHtml(`${heading}${html}`, theme),
    "</section>",
  ]
    .filter(Boolean)
    .join("");
}
