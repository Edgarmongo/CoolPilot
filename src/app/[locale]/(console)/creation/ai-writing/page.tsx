"use client";

import { Suspense } from "react";
import { AiWritingWorkspace } from "@/components/creation/ai-writing/ai-writing-workspace";

/**
 * The workspace reads `?topicId=<id>` with `useSearchParams` - the "write about it" link a topic row
 * offers (CI-P2-01) - and a route that is prerendered needs a `Suspense` boundary above that hook or
 * the production build fails with "missing-suspense-with-csr-bailout". Same reason, same fix as
 * `creation/articles/page.tsx` for its own `?edit=<id>`.
 */
export default function AiWritingPage() {
  return (
    <Suspense fallback={null}>
      <AiWritingWorkspace />
    </Suspense>
  );
}

