"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "responsive";
  /** Extra controls rendered in the header, immediately left of the close button. */
  headerActions?: React.ReactNode;
  /**
   * Expand the panel to (almost) the whole viewport. The body turns into a
   * full-height flex column so callers can stretch content (e.g. a live
   * preview) to fill the space.
   */
  fullscreen?: boolean;
};

const widthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-4xl",
  /** Scales with the viewport (≈85vw) and stops at a comfortable reading cap. */
  responsive: "max-w-[min(85vw,80rem)]",
};

export function Dialog({
  open,
  onClose,
  title,
  children,
  maxWidth = "md",
  headerActions,
  fullscreen = false,
}: DialogProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "relative z-10 grid gap-4 rounded-2xl border border-border bg-background shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]",
          fullscreen
            ? "h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)]"
            : cn("w-full", widthClasses[maxWidth]),
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={cn("min-w-0 px-6 pb-6", fullscreen && "flex min-h-0 flex-col overflow-y-auto")}>
          {children}
        </div>
      </div>
    </div>
  );
}
