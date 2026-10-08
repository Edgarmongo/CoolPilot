"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind width utility for the panel, e.g. "max-w-lg". */
  widthClassName?: string;
};

export function Drawer({ open, onClose, title, children, footer, widthClassName = "max-w-lg" }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 flex h-full w-full flex-col border-l border-border bg-background shadow-[-24px_0_80px_-32px_rgba(15,23,42,0.45)]",
          widthClassName,
        )}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? <div className="border-t border-border/70 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
