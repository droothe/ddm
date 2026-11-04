import { useEffect, useState } from "react";
import { ClipboardPaste, FolderOpen, X } from "lucide-react";
import { detectCategory, fileNameFromUrl, useDDM, type Category } from "@/lib/ddm-store";
import { CategoryIcon } from "./CategoryIcon";

const CATS: { key: Category; label: string }[] = [
  { key: "video", label: "Video" },
  { key: "archive", label: "Zip/Archive" },
  { key: "executable", label: "Executable" },
  { key: "audio", label: "Audio" },
];

export function AddDownloadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { add, settings } = useDDM();
  const [url, setUrl] = useState("");
  const [threads, setThreads] = useState(settings.defaultThreads);
  const [path, setPath] = useState(settings.defaultDir);
  const [pasteMsg, setPasteMsg] = useState("");

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setUrl(t.trim()); setPasteMsg(""); }
    } catch { setPasteMsg("Clipboard access blocked — paste manually (Ctrl+V)."); }
  };

  useEffect(() => {
    if (open) { setThreads(settings.defaultThreads); setPath(settings.defaultDir); setUrl(""); paste(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const valid = /^https?:\/\/.+/i.test(url);
  const cat = url ? detectCategory(fileNameFromUrl(url)) : null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-card-foreground">New Download</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <label className="text-xs uppercase tracking-wider text-muted-foreground">URL (DDL / Video)</label>
        <div className="mt-1.5 flex gap-2">
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/file.zip"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />
          <button onClick={paste} className="rounded-md border border-input px-3 text-muted-foreground hover:text-primary" aria-label="Paste"><ClipboardPaste className="h-4 w-4" /></button>
        </div>
        {pasteMsg && <p className="mt-1 text-xs text-warning">{pasteMsg}</p>}

        <label className="mt-5 block text-xs uppercase tracking-wider text-muted-foreground">Save path</label>
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-input bg-background px-3">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <input value={path} onChange={(e) => setPath(e.target.value)} className="flex-1 bg-transparent py-2 font-mono text-sm outline-none" />
        </div>

        <div className="mt-5 flex justify-between text-xs uppercase tracking-wider text-muted-foreground">
          <span>Threads</span><span className="font-mono text-primary">{threads}</span>
        </div>
        <input type="range" min={1} max={16} value={threads} onChange={(e) => setThreads(+e.target.value)} className="mt-2 w-full accent-primary" />

        <div className="mt-5 text-xs uppercase tracking-wider text-muted-foreground">Category (auto-detected)</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATS.map((c) => (
            <span key={c.key} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${cat === c.key ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground"}`}>
              <CategoryIcon category={c.key} className="h-3.5 w-3.5" /> {c.label}
            </span>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button disabled={!valid} onClick={() => { add(url, threads, path); onClose(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40 glow">
            Start Download
          </button>
        </div>
      </div>
    </div>
  );
}
