"use client";

import { useState } from "react";
import { HelpCircle, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { consoleInputClass } from "@/components/ui/console-surface";

export function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex items-center gap-1 text-sm font-medium text-zinc-700">
      {label}
      {hint ? <HelpCircle className="size-3.5 text-zinc-300" aria-label={hint} /> : null}
    </span>
  );
}

export function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span className="ml-auto text-xs tabular-nums text-zinc-400">
      {value}/{max}
    </span>
  );
}

export function Field({
  label,
  hint,
  counter,
  children,
  className,
}: {
  label: string;
  hint?: string;
  counter?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="flex items-center">
        <FieldLabel label={label} hint={hint} />
        {counter}
      </span>
      {children}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  onLabel,
  offLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm font-medium transition",
        checked ? "bg-sky-500 text-white shadow-sm" : "bg-zinc-200 text-zinc-600",
      )}
    >
      <span
        className={cn(
          "grid size-4 place-items-center rounded-full bg-white/90 text-[9px] font-bold text-sky-600",
          checked ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      >
        ✓
      </span>
      {checked ? onLabel : offLabel}
    </button>
  );
}

export function TagInput({
  values,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
}) {
  const [input, setInput] = useState("");

  function commit() {
    const text = input.trim();
    if (!text) return;
    if (!values.includes(text)) onChange([...values, text]);
    setInput("");
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
          className={consoleInputClass}
        />
        <button
          type="button"
          onClick={commit}
          aria-label={addLabel}
          className="grid size-10 shrink-0 place-items-center rounded-2xl border border-sky-100 bg-white text-sky-600 transition hover:bg-sky-50"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700"
            >
              {value}
              <button
                type="button"
                aria-label={`${removeLabel} ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
                className="text-sky-400 transition hover:text-sky-700"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RangeField({
  label,
  value,
  onChange,
  leftLabel,
  midLabel,
  rightLabel,
  hint,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  leftLabel: string;
  midLabel: string;
  rightLabel: string;
  hint: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-700">
        {label}
        <HelpCircle className="size-3.5 text-zinc-300" aria-label={hint} />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-sky-200 via-sky-400 to-sky-600 accent-sky-600"
      />
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{leftLabel}</span>
        <span>{midLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <p className="text-xs leading-5 text-zinc-400">{hint}</p>
    </div>
  );
}

export function NoticeBanner({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-violet-900">
        <span className="grid size-5 place-items-center rounded-full bg-violet-500 text-[11px] font-bold text-white" aria-hidden>
          i
        </span>
        {title}
      </p>
      {children ? <div className="mt-1 pl-7 text-xs leading-5 text-violet-800/80">{children}</div> : null}
    </div>
  );
}
