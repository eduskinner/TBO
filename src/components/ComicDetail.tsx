import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, BookOpen, Trash2, Check, Star } from "lucide-react";
import { useStore } from "../store";
import type { Comic, ReadStatus } from "../types";

export default function ComicDetail() {
  const { selectedComic, goLibrary, openReader, updateComic, toggleRead, deleteComic } = useStore();
  const [form, setForm] = useState<Comic | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (selectedComic) {
      setForm({ ...selectedComic });
      setCover(null);
      invoke<string>("get_cover", {
        comicId: selectedComic.id,
        filePath: selectedComic.file_path,
      }).then(setCover).catch(() => {});
    }
  }, [selectedComic?.id]);

  if (!form || !selectedComic) return null;

  const set = (key: keyof Comic, val: any) =>
    setForm((prev) => prev ? { ...prev, [key]: val } : prev);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    await updateComic(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDelete = async () => {
    if (!confirm(`Remove "${selectedComic.title}" from your library?\n\nThe file will NOT be deleted from disk.`)) return;
    await deleteComic(selectedComic.id);
  };

  const formatBytes = (b: number) => {
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const statusColor: Record<ReadStatus, string> = {
    unread: "var(--text3)",
    reading: "var(--accent)",
    read: "#4ade80",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Topbar */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-3 px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}
      >
        <button
          onClick={goLibrary}
          className="flex items-center gap-1.5 text-sm transition-all"
          style={{ color: "var(--text2)" }}
        >
          <ArrowLeft size={15} />
          Library
        </button>
        <span style={{ color: "var(--text3)" }}>/</span>
        <span className="truncate" style={{ color: "var(--text)", fontWeight: 500, fontSize: 13 }}>
          {selectedComic.title}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Cover sidebar */}
        <div
          className="flex flex-col items-center gap-4 p-6 overflow-y-auto"
          style={{ width: 260, minWidth: 260, borderRight: "1px solid var(--border)", background: "var(--bg)" }}
        >
          {/* Cover */}
          <div
            className="w-full overflow-hidden rounded-xl"
            style={{
              aspectRatio: "2/3",
              background: "var(--bg3)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            {cover ? (
              <img src={cover} alt={form.title} className="w-full h-full object-cover fade-in" draggable={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="skeleton w-full h-full" />
              </div>
            )}
          </div>

          {/* Read button */}
          <button
            onClick={() => openReader(selectedComic)}
            className="flex items-center gap-2 w-full justify-center py-3 rounded-xl font-semibold text-sm transition-all"
            style={{ background: "var(--accent)", color: "#0C0C0E", letterSpacing: 0.5 }}
          >
            <BookOpen size={16} />
            {selectedComic.current_page > 0 ? `Continue (p.${selectedComic.current_page + 1})` : "Read"}
          </button>

          {/* Status */}
          <div className="w-full flex gap-2">
            {(["unread", "reading", "read"] as ReadStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => set("read_status", s)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all capitalize"
                style={{
                  background: form.read_status === s ? "var(--bg4)" : "transparent",
                  color: form.read_status === s ? statusColor[s] : "var(--text3)",
                  border: `1px solid ${form.read_status === s ? "var(--border)" : "transparent"}`,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Rating */}
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => set("rating", form.rating === n ? null : n)}
                style={{ color: n <= (form.rating ?? 0) ? "var(--accent)" : "var(--text3)" }}
                className="transition-colors"
              >
                <Star size={18} fill={n <= (form.rating ?? 0) ? "var(--accent)" : "none"} />
              </button>
            ))}
          </div>

          {/* File info */}
          <div
            className="w-full rounded-lg p-3 text-xs"
            style={{ background: "var(--bg3)", color: "var(--text2)", lineHeight: 1.8 }}
          >
            <div className="flex justify-between"><span>Pages</span><span style={{ color: "var(--text)", fontFamily: "monospace" }}>{selectedComic.page_count}</span></div>
            <div className="flex justify-between"><span>Size</span><span style={{ color: "var(--text)", fontFamily: "monospace" }}>{formatBytes(selectedComic.file_size)}</span></div>
            <div className="flex justify-between"><span>Format</span><span style={{ color: "var(--text)", fontFamily: "monospace" }}>{selectedComic.file_name.endsWith(".cbr") ? "CBR" : "CBZ"}</span></div>
          </div>
        </div>

        {/* Metadata form */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-lg">
            <h1
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 28,
                color: "var(--text)",
                lineHeight: 1.2,
                marginBottom: 6,
              }}
            >
              {form.title || "Untitled"}
            </h1>
            {form.series && (
              <p style={{ color: "var(--accent)", fontSize: 13, marginBottom: 24 }}>
                {form.series}{form.issue_number ? ` · Issue #${form.issue_number}` : ""}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Title"        value={form.title}        onChange={(v) => set("title", v)} span />
              <Field label="Series"       value={form.series}       onChange={(v) => set("series", v)} />
              <Field label="Issue #"      value={form.issue_number} onChange={(v) => set("issue_number", v)} />
              <Field label="Year"         value={form.year?.toString() ?? ""} onChange={(v) => set("year", v ? parseInt(v) : null)} />
              <Field label="Publisher"    value={form.publisher}    onChange={(v) => set("publisher", v)} />
              <Field label="Writer"       value={form.writer}       onChange={(v) => set("writer", v)} />
              <Field label="Artist"       value={form.artist}       onChange={(v) => set("artist", v)} />
              <Field label="Genre"        value={form.genre}        onChange={(v) => set("genre", v)} />
              <Field label="Tags"         value={form.tags}         onChange={(v) => set("tags", v)} span placeholder="comma separated" />
              <Field label="Notes"        value={form.notes}        onChange={(v) => set("notes", v)} span multiline />
            </div>

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
                style={{ background: saved ? "#4ade80" : "var(--accent)", color: "#0C0C0E" }}
              >
                {saved ? <><Check size={15} /> Saved</> : saving ? "Saving…" : "Save Changes"}
              </button>

              <button
                onClick={handleDelete}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all"
                style={{ color: "#f87171", background: "var(--bg3)" }}
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  span,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  span?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const base = {
    background: "var(--bg3)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    width: "100%",
    fontFamily: "'Outfit', sans-serif",
    transition: "border-color 0.15s",
  } as React.CSSProperties;

  return (
    <div className={span ? "col-span-2" : ""}>
      <label
        className="block mb-1.5"
        style={{ fontSize: 11, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 1 }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ ...base, resize: "vertical" }}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={base}
          onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
        />
      )}
    </div>
  );
}
