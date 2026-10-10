import { describe, expect, it } from "vitest";
import {
  NAVIGATION_JOURNAL_LIMIT,
  NO_DRAFT_HANDED_OVER,
  draftPrepared,
  noteNavigationCause,
  offeredDraftFields,
  recordNavigation,
  takeNavigationCause,
  toSnapshot,
  type BrowserPreviewSession,
} from "./browser-preview-shared";

/**
 * The navigation journal (C2-1c of `docs/assisted-publishing-engine.md`) and the draft's own record
 * of what the platform page took (C2-1a).
 *
 * The smoke's second false row was written for a page the app never navigated away from, and no
 * artifact could say who moved it - the session had been torn down before anyone could ask. These
 * cases pin the two things that make the question answerable: a navigation is attributed to the
 * cause announced for it, and the trace is bounded and copied out rather than handed over.
 *
 * The evidence cases pin the answer the same smoke exposed on the other end: `drafted` used to mean
 * "the prefill did not throw", so a page that took none of the content and a page holding the whole
 * draft were one value. `draftPrepared` is where that stopped being true.
 */

/** A session with nothing on it but the fields the journal uses. */
function blankSession(): BrowserPreviewSession {
  return {
    accountId: "acc-1",
    accountName: "小红书",
    profilePath: "preview/acc-1",
    status: "ready",
    journal: [],
    startedAt: 0,
    updatedAt: 0,
    contextBound: false,
    boundPages: new WeakSet(),
  } as unknown as BrowserPreviewSession;
}

describe("navigation journal", () => {
  it("attributes a navigation to the announced cause, and consumes it", () => {
    const session = blankSession();

    noteNavigationCause(session, "draft", "configured_create_post");
    expect(takeNavigationCause(session)).toEqual({ cause: "draft", detail: "configured_create_post" });
    // Consumed: the next navigation is nobody's, which reads as the platform moving the page.
    expect(takeNavigationCause(session)).toEqual({ cause: "platform" });
  });

  it("keeps the journal bounded, dropping the oldest navigation", () => {
    const session = blankSession();
    const total = NAVIGATION_JOURNAL_LIMIT + 5;
    for (let index = 0; index < total; index += 1) {
      recordNavigation(session, { at: index, url: `https://example.com/${index}`, cause: "platform" });
    }

    expect(session.journal).toHaveLength(NAVIGATION_JOURNAL_LIMIT);
    // The five oldest went, so the trace starts at the sixth navigation.
    expect(session.journal[0]).toMatchObject({ at: 5, url: "https://example.com/5" });
    expect(session.journal[session.journal.length - 1]).toMatchObject({ at: total - 1 });
  });

  it("hands the snapshot a copy, so a reader cannot rewrite the trace", () => {
    const session = blankSession();
    recordNavigation(session, { at: 1, url: "https://example.com/one", cause: "boot" });

    const snapshot = toSnapshot(session);
    expect(snapshot.journal).toEqual(session.journal);

    snapshot.journal[0].url = "https://example.com/tampered";
    snapshot.journal.push({ at: 2, url: "https://example.com/two", cause: "user" });
    expect(session.journal).toHaveLength(1);
    expect(session.journal[0].url).toBe("https://example.com/one");
  });

  it("reports an empty trace for a session that does not exist", () => {
    expect(toSnapshot(undefined).journal).toEqual([]);
  });
});

describe("draft evidence", () => {
  it("counts a page that took something as prepared, whatever else it left alone", () => {
    expect(draftPrepared({ title: "filled", text: "empty", media: "empty" })).toBe(true);
  });

  it("refuses to call a page prepared when it took nothing that was offered", () => {
    // 小红书's creator home, as the smoke measured it: the title and the text were offered and
    // neither was accepted, so there is no draft to hand an author.
    expect(draftPrepared({ title: "empty", text: "empty", media: "not_offered" })).toBe(false);
    // The case the old `wantedFields === 0` rule could not see. An image-only draft has nothing to
    // type, so `drafted` used to stay true however the page answered the upload.
    expect(draftPrepared({ title: "not_offered", text: "not_offered", media: "empty" })).toBe(false);
  });

  it("keeps a run with nothing to hand over from reading as a failure", () => {
    // A media-only draft, or a prefill that was never given content: `not_offered` everywhere is not
    // a page that refused - it is a run with nothing to answer for.
    expect(draftPrepared(NO_DRAFT_HANDED_OVER)).toBe(true);
  });

  it("shows only the fields that were offered, in the order they are handed over", () => {
    expect(offeredDraftFields({ title: "filled", text: "not_offered", media: "empty" })).toEqual([
      { field: "title", outcome: "filled" },
      { field: "media", outcome: "empty" },
    ]);
    // Nothing offered: nothing to report, and no `✗` to blame the platform for.
    expect(offeredDraftFields(NO_DRAFT_HANDED_OVER)).toEqual([]);
  });
});
