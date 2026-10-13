"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Handshake, Plus, Trash2, TriangleAlert } from "lucide-react";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  formatDealAmountMinor,
  marketingLeadErrorKey,
  marketingLeadStatusLabelKeys,
  marketingLeadStatusTones,
  parseDealAmountInput,
} from "@/lib/leads";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  marketingLeadStatuses,
  type MarketingLeadPayload,
  type MarketingLeadRecord,
  type MarketingLeadStatus,
  type PublishRecord,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleCard, ConsoleNotice, ConsoleSectionHeader, consoleInputClass } from "@/components/ui/console-surface";

/**
 * 营销线索与成交 (CI-LEAD-01) - the console surface.
 *
 * Three boundaries this component does not cross:
 *
 *  - **It never invents a number.** There is no sample lead, no estimated conversion and no placeholder
 *    amount: an empty workspace shows an empty state, 已成交 without an amount says 未记录金额, and the
 *    成交金额 cards are drawn per currency because two currencies have no common total.
 *  - **It never sends money as a float.** The typed text is parsed with `parseDealAmountInput` before any
 *    call, and an unparseable amount stops at the dialog with its own message.
 *  - **It never hides a refusal.** A write the route refuses (for example moving a lead that holds a deal
 *    out of 已成交) is shown with its own sentence (`marketingLeadErrorKey`), and the stored rows stay on
 *    screen meanwhile.
 */
type LeadDraft = {
  /** `null` while creating; the stored id while editing. */
  id: string | null;
  name: string;
  contact: string;
  sourcePlatform: string;
  /** `''` = unlinked. The route derives the content from whatever record is named here. */
  publishRecordId: string;
  status: MarketingLeadStatus;
  note: string;
  /** The amount as typed; parsed to minor units only when the dialog is submitted. */
  dealAmount: string;
  dealCurrency: string;
  /** `yyyy-mm-dd` from the date input; empty = 未记录. */
  dealClosedAt: string;
  dealNote: string;
  /** The explicit "clear the recorded deal" the server requires before a status leaves 已成交. */
  dealCleared: boolean;
};

const emptyLeadDraft: LeadDraft = {
  id: null,
  name: "",
  contact: "",
  sourcePlatform: "",
  publishRecordId: "",
  status: "new",
  note: "",
  dealAmount: "",
  dealCurrency: "",
  dealClosedAt: "",
  dealNote: "",
  dealCleared: false,
};

function leadDraftOf(lead: MarketingLeadRecord): LeadDraft {
  return {
    id: lead.id,
    name: lead.name,
    contact: lead.contact,
    sourcePlatform: lead.sourcePlatform,
    publishRecordId: lead.publishRecordId ?? "",
    status: lead.status,
    note: lead.note,
    dealAmount: formatDealAmountMinor(lead.dealAmountMinor),
    dealCurrency: lead.dealCurrency,
    dealClosedAt: lead.dealClosedAt ? new Date(lead.dealClosedAt).toISOString().slice(0, 10) : "",
    dealNote: lead.dealNote,
    dealCleared: false,
  };
}

export function leadDraftIssueKey(draft: LeadDraft): TranslationKey | null {
  if (!draft.name.trim()) return "leadNameRequired";
  const amount = parseDealAmountInput(draft.dealAmount);
  if (amount.status === "invalid") return "leadAmountInvalid";
  const carriesDeal =
    amount.status === "ok" ||
    draft.dealCurrency.trim() !== "" ||
    draft.dealClosedAt !== "" ||
    draft.dealNote.trim() !== "";
  if (draft.status === "won") {
    return amount.status === "ok" && !draft.dealCurrency.trim() ? "leadCurrencyRequired" : null;
  }
  // The server refuses this too (`LEAD_DEAL_RECORDED`); saying it here means the user reads the rule
  // before the round trip, and the checkbox next to it is how they accept the clear.
  return carriesDeal && !draft.dealCleared ? "leadDealNeedsWon" : null;
}

/** The body a save sends: amounts already in minor units, dates already in milliseconds. */
export function leadDraftPayload(draft: LeadDraft) {
  const amount = parseDealAmountInput(draft.dealAmount);
  const amountMinor = amount.status === "ok" ? amount.amountMinor : null;
  return {
    name: draft.name.trim(),
    contact: draft.contact.trim(),
    sourcePlatform: draft.sourcePlatform.trim(),
    publishRecordId: draft.publishRecordId ? draft.publishRecordId : null,
    status: draft.status,
    note: draft.note.trim(),
    dealAmountMinor: amountMinor,
    dealCurrency: amountMinor === null ? "" : draft.dealCurrency.trim(),
    dealClosedAt: draft.dealClosedAt ? new Date(`${draft.dealClosedAt}T00:00:00`).getTime() : null,
    dealNote: draft.dealNote.trim(),
    dealCleared: draft.dealCleared,
  };
}

const leadBadgeClass = {
  sky: "rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700",
  amber: "rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700",
  emerald: "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700",
  zinc: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600",
} as const;

export function MarketingLeadsWorkspace() {
  const { t } = useI18n();
  const { data, error, isLoading, mutate } = useSWR<MarketingLeadPayload>("/api/leads", swrFetcher);
  const [statusFilter, setStatusFilter] = useState<MarketingLeadStatus | "all">("all");
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MarketingLeadRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: TranslationKey; tone: "success" | "error" } | null>(null);

  const payload = data ?? null;
  const rows = useMemo(
    () => (payload?.leads ?? []).filter((lead) => statusFilter === "all" || lead.status === statusFilter),
    [payload, statusFilter],
  );
  const contentTitles = useMemo(
    () => new Map((payload?.contents ?? []).map((item) => [item.id, item.title])),
    [payload],
  );
  const publishRecords = useMemo(() => new Map((payload?.publishes ?? []).map((item) => [item.id, item])), [payload]);
  const readErrorKey = error ? marketingLeadErrorKey(error, "leadLoadFailed") : null;
  const summary = payload?.summary ?? null;
  /**
   * The records the dialog can link a lead to. Read from the route that already lists them rather than
   * from the payload: the payload only names the records the stored leads already point at, and a lead
   * being created has no record yet.
   */
  const { data: publishOptions } = useSWR<PublishRecord[]>("/api/publish-records?limit=200", swrFetcher);

  async function save() {
    if (!draft || busy) return;
    const issue = leadDraftIssueKey(draft);
    if (issue) {
      setNotice({ key: issue, tone: "error" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const body = leadDraftPayload(draft);
      if (draft.id) {
        await apiPatch<MarketingLeadRecord>(`/api/leads/${encodeURIComponent(draft.id)}`, body);
        setNotice({ key: "leadUpdated", tone: "success" });
      } else {
        await apiPost<MarketingLeadRecord>("/api/leads", body);
        setNotice({ key: "leadCreated", tone: "success" });
      }
      setDraft(null);
      await mutate();
    } catch (callError) {
      setNotice({ key: marketingLeadErrorKey(callError), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await apiDelete(`/api/leads/${encodeURIComponent(deleteTarget.id)}`);
      setDeleteTarget(null);
      setNotice({ key: "leadDeleted", tone: "success" });
      await mutate();
    } catch (callError) {
      setNotice({ key: marketingLeadErrorKey(callError), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ConsoleCard>
        <ConsoleSectionHeader
          icon={<Handshake size={20} />}
          title={t("leadTitle")}
          action={
            <Button
              type="button"
              onClick={() => {
                setNotice(null);
                setDraft({ ...emptyLeadDraft });
              }}
            >
              <Plus size={16} />
              {t("leadAdd")}
            </Button>
          }
        />
        <p className="mt-3 text-sm text-zinc-500">{t("leadSubtitle")}</p>
        {notice ? (
          <div className="mt-4">
            <ConsoleNotice message={t(notice.key)} tone={notice.tone} onDismiss={() => setNotice(null)} />
          </div>
        ) : null}
        {readErrorKey ? (
          <div className="mt-4">
            <ConsoleNotice message={t(readErrorKey)} tone="error" onDismiss={() => void mutate()} />
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3">
            <p className="text-xs text-zinc-500">{t("leadTotal")}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{summary ? summary.total : "—"}</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
            <p className="text-xs text-zinc-500">{t("leadOpen")}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{summary ? summary.open : "—"}</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
            <p className="text-xs text-zinc-500">{t("leadWon")}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">{summary ? summary.won : "—"}</p>
            {summary && summary.wonWithoutAmount > 0 ? (
              <p className="mt-1 text-xs text-amber-700">
                {t("leadWonWithoutAmount")}: {summary.wonWithoutAmount}
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-xs text-zinc-500">{t("leadAmounts")}</p>
            {summary && summary.amounts.length ? (
              <ul className="mt-1 space-y-0.5">
                {summary.amounts.map((total) => (
                  <li key={total.currency} className="text-sm font-semibold text-zinc-900">
                    {formatDealAmountMinor(total.amountMinor)} {total.currency}
                    <span className="ml-1 font-normal text-zinc-500">
                      ({t("leadDealsCount")}: {total.deals})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">{t("leadNoAmountRecorded")}</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="text-sm text-zinc-600" htmlFor="lead-status-filter">
            {t("leadFilterStatus")}
          </label>
          <select
            id="lead-status-filter"
            className={`${consoleInputClass} max-w-48`}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as MarketingLeadStatus | "all")}
          >
            <option value="all">{t("leadFilterAll")}</option>
            {marketingLeadStatuses.map((status) => (
              <option key={status} value={status}>
                {t(marketingLeadStatusLabelKeys[status])}
              </option>
            ))}
          </select>
        </div>

      </ConsoleCard>
      <ConsoleCard>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-zinc-900">{t("leadListTitle")}</h3>
          <span className="text-xs text-zinc-400">
            {t("leadCountShown", { count: rows.length, total: summary?.total ?? 0 })}
          </span>
        </div>
        {isLoading ? (
          <p className="mt-4 text-sm text-zinc-500">{t("leadLoading")}</p>
        ) : !payload ? (
          <p className="mt-4 text-sm text-zinc-500">{t("leadLoadFailed")}</p>
        ) : payload.summary.total === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-sky-200 bg-sky-50/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-zinc-800">{t("leadEmptyTitle")}</p>
            <p className="mt-1 text-xs text-zinc-500">{t("leadEmptyBody")}</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t("leadFilterEmpty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-sky-100 text-left text-xs text-zinc-500">
                  <th className="px-3 py-2">{t("leadColName")}</th>
                  <th className="px-3 py-2">{t("leadColContact")}</th>
                  <th className="px-3 py-2">{t("leadColSource")}</th>
                  <th className="px-3 py-2">{t("leadColContent")}</th>
                  <th className="px-3 py-2">{t("leadColStatus")}</th>
                  <th className="px-3 py-2">{t("leadColDeal")}</th>
                  <th className="px-3 py-2">{t("leadColCreated")}</th>
                  <th className="px-3 py-2 text-right">{t("leadColActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => {
                  const publish = lead.publishRecordId ? publishRecords.get(lead.publishRecordId) : undefined;
                  const contentTitle = lead.contentItemId ? (contentTitles.get(lead.contentItemId) ?? "") : "";
                  return (
                    <tr key={lead.id} className="border-b border-sky-50 align-top">
                      <td className="px-3 py-3 font-medium text-zinc-900">{lead.name}</td>
                      <td className="px-3 py-3 text-zinc-600">{lead.contact || "—"}</td>
                      <td className="px-3 py-3 text-zinc-600">{lead.sourcePlatform || "—"}</td>
                      <td className="px-3 py-3 text-zinc-600">
                        <span>{contentTitle || t("leadUnlinked")}</span>
                        {publish ? (
                          <span className="mt-1 block text-xs text-zinc-400">
                            {t("leadPublishLink")}: {publish.platform || "—"}
                            {publish.url ? (
                              <a
                                className="ml-1 text-sky-600 underline"
                                href={publish.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {t("leadOpenPost")}
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <span className={leadBadgeClass[marketingLeadStatusTones[lead.status]]}>
                          {t(marketingLeadStatusLabelKeys[lead.status])}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-zinc-700">
                        {lead.status === "won"
                          ? lead.dealAmountMinor === null
                            ? t("leadWonNoAmount")
                            : `${formatDealAmountMinor(lead.dealAmountMinor)} ${lead.dealCurrency}`.trim()
                          : "—"}
                        {lead.dealClosedAt ? (
                          <span className="mt-1 block text-xs text-zinc-400">
                            {t("leadClosedAt")}: {new Date(lead.dealClosedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-zinc-500">{new Date(lead.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setNotice(null);
                              setDraft(leadDraftOf(lead));
                            }}
                          >
                            {t("leadEdit")}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setNotice(null);
                              setDeleteTarget(lead);
                            }}
                          >
                            <Trash2 size={14} />
                            {t("leadDelete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleCard>
      <ConsoleCard>
        <h3 className="text-base font-semibold text-zinc-900">{t("leadByContentTitle")}</h3>
        <p className="mt-1 text-xs text-zinc-500">{t("leadByContentHint")}</p>
        {summary && summary.byContent.length ? (
          <ul className="mt-4 space-y-2">
            {summary.byContent.map((entry) => (
              <li
                key={entry.contentItemId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-100 px-4 py-3"
              >
                <span className="text-sm font-medium text-zinc-800">
                  {entry.title || t("leadUnresolvedContent")}
                </span>
                <span className="text-xs text-zinc-500">
                  {t("leadLeadsCount")}: {entry.leads} · {t("leadWonCount")}: {entry.won}
                  {entry.amounts.length
                    ? ` · ${entry.amounts
                        .map((total) => `${formatDealAmountMinor(total.amountMinor)} ${total.currency}`)
                        .join(" | ")}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">{t("leadByContentEmpty")}</p>
        )}
        {summary && (summary.unattributed.leads > 0 || summary.wonWithoutAmount > 0) ? (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <TriangleAlert size={16} />
            <span>
              {summary.unattributed.leads > 0
                ? `${t("leadUnattributed")}: ${summary.unattributed.leads}（${t("leadWonCount")}: ${summary.unattributed.won}）`
                : ""}
              {summary.unattributed.leads > 0 && summary.wonWithoutAmount > 0 ? " · " : ""}
              {summary.wonWithoutAmount > 0 ? `${t("leadWonWithoutAmount")}: ${summary.wonWithoutAmount}` : ""}
            </span>
          </div>
        ) : null}
      </ConsoleCard>
      {draft ? (
        <Dialog
          open
          onClose={() => setDraft(null)}
          title={draft.id ? t("leadEditTitle") : t("leadAddTitle")}
          maxWidth="lg"
        >
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm text-zinc-600">
                {t("leadFieldName")}
                <input
                  className={consoleInputClass}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm text-zinc-600">
                {t("leadFieldContact")}
                <input
                  className={consoleInputClass}
                  value={draft.contact}
                  placeholder={t("leadFieldContactHint")}
                  onChange={(event) => setDraft({ ...draft, contact: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm text-zinc-600">
                {t("leadFieldSource")}
                <input
                  className={consoleInputClass}
                  value={draft.sourcePlatform}
                  placeholder={t("leadFieldSourceHint")}
                  onChange={(event) => setDraft({ ...draft, sourcePlatform: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm text-zinc-600">
                {t("leadFieldStatus")}
                <select
                  className={consoleInputClass}
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as MarketingLeadStatus, dealCleared: false })
                  }
                >
                  {marketingLeadStatuses.map((status) => (
                    <option key={status} value={status}>
                      {t(marketingLeadStatusLabelKeys[status])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm text-zinc-600">
              {t("leadFieldPublish")}
              <select
                className={consoleInputClass}
                value={draft.publishRecordId}
                onChange={(event) => setDraft({ ...draft, publishRecordId: event.target.value })}
              >
                <option value="">{t("leadFieldPublishNone")}</option>
                {(publishOptions ?? []).map((record) => (
                  <option key={record.id} value={record.id}>
                    {`${record.platform || "—"} · ${record.title || record.id}`}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-400">{t("leadFieldPublishHint")}</span>
            </label>
            {draft.status === "won" ? (
              <div className="grid gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:grid-cols-2">
                <p className="text-xs text-emerald-800 sm:col-span-2">{t("leadDealHint")}</p>
                <label className="grid gap-1 text-sm text-zinc-600">
                  {t("leadFieldDealAmount")}
                  <input
                    className={consoleInputClass}
                    value={draft.dealAmount}
                    inputMode="decimal"
                    onChange={(event) => setDraft({ ...draft, dealAmount: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-600">
                  {t("leadFieldDealCurrency")}
                  <input
                    className={consoleInputClass}
                    value={draft.dealCurrency}
                    placeholder={t("leadFieldDealCurrencyHint")}
                    onChange={(event) => setDraft({ ...draft, dealCurrency: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-600">
                  {t("leadFieldDealClosedAt")}
                  <input
                    type="date"
                    className={consoleInputClass}
                    value={draft.dealClosedAt}
                    onChange={(event) => setDraft({ ...draft, dealClosedAt: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm text-zinc-600 sm:col-span-2">
                  {t("leadFieldDealNote")}
                  <input
                    className={consoleInputClass}
                    value={draft.dealNote}
                    onChange={(event) => setDraft({ ...draft, dealNote: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
            {draft.status !== "won" &&
            (draft.dealAmount || draft.dealCurrency || draft.dealClosedAt || draft.dealNote) ? (
              <label className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={draft.dealCleared}
                  onChange={(event) => setDraft({ ...draft, dealCleared: event.target.checked })}
                />
                <span>{t("leadDealClearHint")}</span>
              </label>
            ) : null}

            <label className="grid gap-1 text-sm text-zinc-600">
              {t("leadFieldNote")}
              <textarea
                className={consoleInputClass}
                rows={3}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                {t("leadCancel")}
              </Button>
              <Button type="button" loading={busy} onClick={() => void save()}>
                {t("leadSave")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {deleteTarget ? (
        <Dialog open onClose={() => setDeleteTarget(null)} title={t("leadDeleteTitle")} maxWidth="sm">
          <p className="text-sm text-zinc-600">{t("leadDeleteConfirm", { name: deleteTarget.name })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t("leadCancel")}
            </Button>
            <Button type="button" variant="danger" loading={busy} onClick={() => void remove()}>
              {t("leadConfirmDelete")}
            </Button>
          </div>
        </Dialog>
      ) : null}




    </div>
  );
}

