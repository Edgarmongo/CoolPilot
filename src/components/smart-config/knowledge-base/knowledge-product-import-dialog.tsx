"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { PositionRecord } from "@/lib/types";
import { Field, NoticeBanner } from "../positioning-fields";

export function KnowledgeProductImportDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { data: positions = [] } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const [positionId, setPositionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleImport() {
    setLoading(true);
    setError("");
    try {
      await apiPost("/api/knowledge-base/import-products", { positionId });
      onSaved();
      onClose();
    } catch {
      setError(t("kbProductImportEmpty"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("kbProductImportTitle")} maxWidth="md">
      <div className="grid gap-4">
        <NoticeBanner title={t("kbProductImportTitle")}>
          <p>{t("kbProductImportDesc")}</p>
        </NoticeBanner>
        <Field label={t("kbProductImportPosition")}>
          <select
            value={positionId}
            onChange={(event) => setPositionId(event.target.value)}
            className={consoleInputClass}
          >
            <option value="">{t("kbPositionGlobal")}</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </select>
        </Field>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleImport()} loading={loading}>
            {t("kbProductImportConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
