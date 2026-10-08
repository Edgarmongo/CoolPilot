"use client";

import { Suspense } from "react";
import { ArticlesWorkspace } from "@/components/creation/articles-workspace";

/**
 * The workspace reads `?edit=<id>` with `useSearchParams` (P5-C1: a generated article opens here), and
 * a route that is prerendered needs a `Suspense` boundary above that hook or the production build fails
 * with "missing-suspense-with-csr-bailout".
 */
export default function ArticlesPage() {
  return (
    <Suspense fallback={null}>
      <ArticlesWorkspace />
    </Suspense>
  );
}
