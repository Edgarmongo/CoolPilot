import ModelManagementClient, { type ModelManagementTab } from "@/components/system/model-management-client";

const modelManagementTabs: readonly ModelManagementTab[] = ["catalog", "registry", "providers", "config"];

function resolveTab(value: string | string[] | undefined): ModelManagementTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return modelManagementTabs.find((entry) => entry === tab) ?? "catalog";
}

export default async function ModelManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  return <ModelManagementClient initialTab={resolveTab(tab)} />;
}
