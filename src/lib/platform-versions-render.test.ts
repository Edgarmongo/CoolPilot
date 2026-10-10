import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlatformVersionsView, {
  type PlatformVersionsViewProps,
} from "@/components/creation/platform-versions-view";
import { I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-config";
import { localeResources } from "@/lib/locale-resources";
import type { PlatformContentProfile, PlatformContentVersion, PlatformContentVersionPayload } from "@/lib/types";

/**
 * CI-P2-07 static render smoke - and only that.
 *
 * **This is not a DOM interaction test.** The repository has no DOM test setup (`vitest.config.ts` is
 * `environment: "node"`, collects `src/**\/*.test.ts` only, and neither `jsdom` nor
 * `@testing-library/*` is installed), so nothing here clicks a button or asserts that a click calls the
 * API. What it does assert is that every state the panel can be in renders the model's own facts
 * instead of a blank or a lie: loading, empty, unreadable, stale, adapter notes, a `null` budget, an
 * error with the stored versions still on screen, the editor, and the delete question.
 *
 * The interaction logic is pinned as plain functions in `platform-version-view.test.ts`; the HTTP
 * contract by `src/app/api/content/[id]/platform-versions/route.test.ts`.
 */

const en = localeResources.en;

/** `t()` takes values as strings/numbers, so an interpolated expectation is the template filled in. */
function filled(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

/** Server rendering escapes `'` as `&#x27;`: undo that before comparing against dictionary text. */
function unescaped(html: string) {
  return html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

function profile(overrides: Partial<PlatformContentProfile> & { platform: string }): PlatformContentProfile {
  return {
    supported: true,
    composerEntry: "generic",
    titleField: true,
    bodyField: true,
    videoRoute: "file-input",
    textLimit: null,
    titleLimit: null,
    ...overrides,
  };
}

function version(overrides: Partial<PlatformContentVersion> = {}): PlatformContentVersion {
  return {
    platform: "小红书",
    title: "存稿标题",
    body: "存稿正文",
    imagePath: "cover.png",
    videoPath: "",
    source: "derived",
    adaptations: [],
    baseFingerprint: "fp-1",
    createdAt: 1,
    updatedAt: Date.UTC(2026, 9, 10, 8, 30),
    ...overrides,
  };
}

function payload(overrides: Partial<PlatformContentVersionPayload> = {}): PlatformContentVersionPayload {
  return {
    contentItemId: "c1",
    base: {
      title: "基线标题",
      body: "基线正文",
      postReadyText: "",
      imagePath: "cover.png",
      images: ["a.png"],
      videoPath: "",
      fingerprint: "fp-1",
      updatedAt: 2,
    },
    profiles: [profile({ platform: "小红书" })],
    versions: [],
    unreadable: 0,
    ...overrides,
  };
}

const noop = () => {};

function baseProps(overrides: Partial<PlatformVersionsViewProps> = {}): PlatformVersionsViewProps {
  return {
    payload: null,
    loading: false,
    errorKey: null,
    busy: null,
    deriveTarget: "",
    onDeriveTargetChange: noop,
    onDerive: noop,
    editingPlatform: null,
    draft: { title: "", body: "" },
    onDraftChange: noop,
    onStartEdit: noop,
    onCancelEdit: noop,
    onSubmitEdit: noop,
    confirmDeletePlatform: null,
    onAskDelete: noop,
    onCancelDelete: noop,
    onConfirmDelete: noop,
    notice: null,
    onDismissNotice: noop,
    ...overrides,
  };
}

function render(props: Partial<PlatformVersionsViewProps> = {}, locale: Locale = "en") {
  return renderToStaticMarkup(
    // `children` travels in the props object: `I18nProvider` declares it as a required prop, so the
    // runtime-children overload (`createElement(type, props, child)`) does not typecheck.
    // eslint-disable-next-line react/no-children-prop -- enforced by `I18nProvider`'s props type.
    createElement(I18nProvider, {
      locale,
      dictionary: localeResources[locale],
      children: createElement(PlatformVersionsView, baseProps(props)),
    }),
  );
}

describe("platform versions view (static markup)", () => {
  it("renders the panel heading and hint", () => {
    const html = unescaped(render());
    expect(html).toContain(en.pvTitle);
    expect(html).toContain(en.pvHint);
  });

  it("says it is loading rather than showing an empty list", () => {
    const html = render({ loading: true });
    expect(html).toContain(en.loading);
    expect(html).not.toContain(en.pvEmpty);
  });

  it("says a failed read failed, rather than showing an empty list", () => {
    // A payload that could not be read is not the same as an item with no versions.
    const html = render({ payload: null, loading: false });
    expect(html).toContain(en.pvLoadFailed);
    expect(html).not.toContain(en.pvEmpty);
  });

  it("shows an empty list as empty", () => {
    const html = unescaped(render({ payload: payload() }));
    expect(html).toContain(en.pvEmpty);
    expect(html).toContain(filled(en.pvCount, { count: 0 }));
    expect(html).not.toContain(en.pvLoadFailed);
    // The not-publishing statement is part of the panel's promise, so it is there whenever it renders.
    expect(html).toContain(en.pvNotPublishing);
  });

  it("counts the entries it could not read instead of dropping them", () => {
    const html = render({ payload: payload({ versions: [version()], unreadable: 2 }) });
    expect(html).toContain(filled(en.pvUnreadableTag, { count: 2 }));
    expect(html).toContain(filled(en.pvUnreadableHint, { count: 2 }));
    expect(html).toContain(filled(en.pvCount, { count: 1 }));
  });

  it("keeps a stale version on screen and says the base moved on", () => {
    const html = render({ payload: payload({ versions: [version({ baseFingerprint: "fp-0" })] }) });
    expect(html).toContain(en.pvStaleTag);
    expect(html).toContain(en.pvStale);
    // Reported, never refreshed behind the author's back - so the stored text is still there.
    expect(html).toContain("存稿正文");
  });

  it("shows the adapter's own notes, with its numbers", () => {
    const html = render({
      payload: payload({
        versions: [
          version({
            adaptations: [{ code: "text-truncated", limit: 449, originalLength: 900 }, { code: "media-not-included" }],
          }),
        ],
      }),
    });
    expect(html).toContain(filled(en.pvAdaptTextTruncated, { limit: 449, original: 900 }));
    expect(html).toContain(en.pvAdaptMediaNotIncluded);
    expect(html).toContain(en.pvSourceDerived);
  });

  it("shows an unrecorded truncation without leaking a placeholder", () => {
    const html = render({ payload: payload({ versions: [version({ adaptations: [{ code: "text-truncated" }] })] }) });
    expect(html).toContain(en.pvAdaptTextTruncatedUnrecorded);
    expect(html).not.toContain("{limit}");
  });

  it("says a platform gets no title instead of showing an empty line", () => {
    const html = render({
      payload: payload({ versions: [version({ title: "", adaptations: [{ code: "title-not-offered" }] })] }),
    });
    expect(html).toContain(en.pvNoTitleForPlatform);
  });

  it("reports a hand-written version as edited", () => {
    const html = render({ payload: payload({ versions: [version({ source: "edited" })] }) });
    expect(html).toContain(en.pvSourceEdited);
  });

  it("states a null budget as this layer's, never as the platform's", () => {
    const html = render({
      payload: payload({ profiles: [profile({ platform: "知乎", titleLimit: null, textLimit: null })] }),
      deriveTarget: "知乎",
    });
    expect(html).toContain(en.pvTextLimitNone);
    expect(html).toContain(en.pvTitleLimitNone);
  });

  it("prints the budget this layer really enforces", () => {
    const html = render({
      payload: payload({ profiles: [profile({ platform: "Threads", textLimit: 449 })] }),
      deriveTarget: "Threads",
    });
    expect(html).toContain(filled(en.pvTextLimit, { limit: 449 }));
  });

  it("shows an action error while the stored versions stay on screen", () => {
    const html = render({ payload: payload({ versions: [version()] }), errorKey: "pvActionFailed" });
    expect(html).toContain(en.pvActionFailed);
    expect(html).toContain("存稿正文");
  });

  it("shows the route's own error code when the item is gone", () => {
    const html = render({ errorKey: "error_NOT_FOUND" });
    expect(html).toContain(en.error_NOT_FOUND);
  });

  it("opens the editor on the stored text when asked", () => {
    const html = render({
      payload: payload({ versions: [version()] }),
      editingPlatform: "小红书",
      draft: { title: "存稿标题", body: "存稿正文" },
    });
    expect(html).toContain(en.pvSave);
    expect(html).toContain(en.pvCancel);
    expect(html).toContain('value="存稿标题"');
  });

  it("asks before deleting, and says what is not touched", () => {
    const html = render({ payload: payload({ versions: [version()] }), confirmDeletePlatform: "小红书" });
    expect(html).toContain(en.pvDeleteConfirm);
  });

  it("escapes stored text instead of rendering it as markup", () => {
    const html = render({ payload: payload({ versions: [version({ body: "<script>alert(1)</script>" })] }) });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("offers a derive target, and says when every platform is covered", () => {
    const withTarget = render({ payload: payload({ profiles: [profile({ platform: "小红书" })] }) });
    expect(withTarget).toContain(en.pvDeriveTarget);
    expect(withTarget).toContain(en.pvDeriveAction);
    const covered = render({
      payload: payload({ profiles: [profile({ platform: "小红书" })], versions: [version({ platform: "小红书" })] }),
    });
    expect(covered).toContain(en.pvDeriveNone);
  });

  it("says there is nothing to adapt to when no platform is connected", () => {
    const html = render({ payload: payload({ profiles: [] }) });
    expect(html).toContain(en.pvDeriveNoProfiles);
  });

  it("reports the base's own text length and media", () => {
    const html = render({ payload: payload() });
    expect(html).toContain(filled(en.pvBaseTextLength, { count: payload().base.body.length }));
  });

  it("renders in the other two locales as well", () => {
    for (const locale of ["zh-cn", "zh-hk"] as const) {
      const html = render({ payload: payload({ versions: [version()] }) }, locale);
      expect(html).toContain(localeResources[locale].pvTitle);
      expect(html).toContain(localeResources[locale].pvNotPublishing);
    }
  });
});
