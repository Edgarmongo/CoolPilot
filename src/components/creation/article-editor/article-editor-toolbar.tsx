"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ToolbarButtonProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function ToolbarButton({ label, active = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Keep the text selection inside the editor when clicking a control.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100",
        active && "bg-sky-100 text-sky-700",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-zinc-200" aria-hidden />;
}

/** Rich-text toolbar for the article editor. Commands are applied with `execCommand`. */
export function ArticleEditorToolbar({
  onCommand,
  onInsertImage,
  onLink,
}: {
  onCommand: (command: string, value?: string) => void;
  onInsertImage: () => void;
  onLink: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-100 px-2 py-1.5">
      {(["h1", "h2", "h3"] as const).map((tag) => (
        <ToolbarButton key={tag} label={tag.toUpperCase()} onClick={() => onCommand("formatBlock", `<${tag}>`)}>
          <span className="font-semibold">{tag.toUpperCase()}</span>
        </ToolbarButton>
      ))}
      <Divider />
      <ToolbarButton label="Bold" onClick={() => onCommand("bold")}>
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Italic" onClick={() => onCommand("italic")}>
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Underline" onClick={() => onCommand("underline")}>
        <Underline className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Strikethrough" onClick={() => onCommand("strikeThrough")}>
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <label
        title="Text colour"
        className="inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg px-1.5 text-zinc-600 transition hover:bg-zinc-100"
      >
        <span className="text-sm font-semibold">A</span>
        <input
          type="color"
          aria-label="Text colour"
          className="sr-only"
          onChange={(event) => onCommand("foreColor", event.target.value)}
        />
      </label>
      <Divider />
      <ToolbarButton label="Align left" onClick={() => onCommand("justifyLeft")}>
        <AlignLeft className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Align center" onClick={() => onCommand("justifyCenter")}>
        <AlignCenter className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Align right" onClick={() => onCommand("justifyRight")}>
        <AlignRight className="size-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Bulleted list" onClick={() => onCommand("insertUnorderedList")}>
        <List className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" onClick={() => onCommand("insertOrderedList")}>
        <ListOrdered className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Quote" onClick={() => onCommand("formatBlock", "<blockquote>")}>
        <Quote className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Divider" onClick={() => onCommand("insertHorizontalRule")}>
        <Minus className="size-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Remove format" onClick={() => onCommand("removeFormat")}>
        <Eraser className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Insert link" onClick={onLink}>
        <Link2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Insert image" onClick={onInsertImage}>
        <ImageIcon className="size-4" />
      </ToolbarButton>
    </div>
  );
}
