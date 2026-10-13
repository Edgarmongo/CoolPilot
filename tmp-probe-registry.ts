import { listProviderViews, loadModelDefaults } from "@/features/ai-runtime/registry";

async function main() {
  const views = await listProviderViews();
  console.log("providers:", views.length);
  // Printed whole: this probe exists to see the runtime's own shape, not to guess field names.
  for (const view of views) {
    console.log(JSON.stringify(view, null, 1));
  }
  console.log("defaults:", JSON.stringify(await loadModelDefaults()));
}

main().catch((error) => {
  console.error("ERR", error);
  process.exitCode = 1;
});
