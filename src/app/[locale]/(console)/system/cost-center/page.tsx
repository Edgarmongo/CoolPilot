import CostCenterClient, { type CostCenterTab } from "@/components/cost-center/cost-center-client";

/**
 * Kept here rather than imported from the client module: a server component only receives a client
 * reference for `"use client"` exports, so reading a runtime array across that boundary fails at
 * runtime (`costCenterTabs.find is not a function`) while still type-checking. Same split as
 * `system/models/page.tsx`.
 */
const costCenterTabs: readonly CostCenterTab[] = ["overview", "calls", "budget", "quality"];

function resolveTab(value: string | string[] | undefined): CostCenterTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return costCenterTabs.find((entry) => entry === tab) ?? "overview";
}

export default async function AiCostCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  return <CostCenterClient initialTab={resolveTab(tab)} />;
}
