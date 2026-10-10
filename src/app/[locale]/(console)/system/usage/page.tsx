import { redirect } from "next/navigation";
import { localizedPath, type Locale } from "@/lib/i18n-config";

/**
 * The old 用量统计 page became the 成本总览 tab of the AI 成本中心 (CI-P7-02; renamed from
 * 「AI 成本与质量优化中心」by CI-IA-01 on 2026-10-10, the menu label only).
 *
 * The URL stays as an alias instead of 404ing: bookmarks, the packaged app's history and any link
 * written before the rename still land on the surface that now owns these figures. The legacy
 * figures themselves did not disappear - the cost-center page still prints them, next to the money.
 */
export default async function UsageAliasPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  redirect(localizedPath(locale, "/system/cost-center"));
}
