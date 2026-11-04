import { useState } from "react";
import { ChevronDown, FolderOpen, Pause, Play, Trash2, X } from "lucide-react";
import { bytesDone, fmtBytes, fmtEta, fmtSpeed, progress, useDDM, type Download, type Status } from "@/lib/ddm-store";
import { CategoryIcon } from "./CategoryIcon";

const STATUS: Record<Status, { label: string; cls: string; bar: string }> = {
  downloading: { label: "Downloading", cls: "text-primary border-primary/40", bar: "bg-primary" },
  paused: { label: "Paused", cls: "text-warning border-warning/40", bar: "bg-warning" },
  completed: { label: "Completed", cls: "text-success border-success/40", bar: "bg-success" },
  merging: { label: "Merging Segments", cls: "text-merge border-merge/40", bar: "bg-merge" },
  error: { label: "Error", cls: "text-destructive border-destructive/40", bar: "bg-destructive" },
  queued: { label: "Queued", cls: "text-muted-foreground border-border", bar: "bg-muted-foreground" },
};

export function DownloadRow({ d }: { d: Download }) {
  const { pause, resume, cancel, remove } = useDDM();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState("");
  const p = progress(d);
  const s = STATUS[d.status];
  const done = bytesDone(d);

  const openFolder = () => { setToast(`Opened ${d.path}`); setTimeout(() => setToast(""), 1800); };

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 md:w-[32%]">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-accent text-accent-foreground grid place-items-center">
            <CategoryIcon category={d.category} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-card-foreground" title={d.name}>{d.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{fmtBytes(done)} / {fmtBytes(d.size)}</div>
          </div>
        </div>

        <div className="flex-1">
          <div className="flex justify-between text-xs mb-1.5">
            <span className={`rounded-full border px-2 py-0.5 ${s.cls}`}>{s.label}</span>
            <span className="font-mono text-card-foreground">{(p * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${s.bar} ${d.status === "downloading" || d.status === "merging" ? "stripes" : ""}`} style={{ width: `${p * 100}%` }} />
          </div>
          <div className="mt-1.5 flex gap-4 text-xs font-mono text-muted-foreground">
            <span>{d.status === "downloading" ? fmtSpeed(d.speed) : "0.00 MB/s"}</span>
            <span>ETA {d.status === "downloading" ? fmtEta(d.size - done, d.speed) : "—"}</span>
            <span>{d.threads} threads</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {d.status === "downloading" || d.status === "queued" ? (
            <Btn label="Pause" onClick={() => pause(d.id)}><Pause className="h-4 w-4" /></Btn>
          ) : (d.status === "paused" || d.status === "error") ? (
            <Btn label="Resume" onClick={() => resume(d.id)}><Play className="h-4 w-4" /></Btn>
          ) : null}
          {d.status !== "completed" && d.status !== "error" && <Btn label="Cancel" onClick={() => cancel(d.id)}><X className="h-4 w-4" /></Btn>}
          <Btn label="Open Folder" onClick={openFolder}><FolderOpen className="h-4 w-4" /></Btn>
          <Btn label="Delete" danger onClick={() => remove(d.id)}><Trash2 className="h-4 w-4" /></Btn>
          <Btn label="Segments" onClick={() => setOpen((o) => !o)}><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></Btn>
        </div>
      </div>
      {toast && <div className="mt-2 text-xs text-primary font-mono">{toast}</div>}
      {open && <SegmentVisualizer d={d} />}
    </div>
  );
}

function Btn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={`p-2 rounded-md text-muted-foreground hover:bg-muted ${danger ? "hover:text-destructive" : "hover:text-primary"}`}>
      {children}
    </button>
  );
}

function SegmentVisualizer({ d }: { d: Download }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex justify-between text-xs text-muted-foreground mb-2">
        <span className="uppercase tracking-wider">HTTP Range segments</span>
        <span className="font-mono">{hover !== null ? `Chunk ${hover + 1}: ${((d.chunks[hover].done / d.chunks[hover].size) * 100).toFixed(1)}%` : "Hover a chunk"}</span>
      </div>
      <div className="flex gap-1 h-6">
        {d.chunks.map((c, i) => {
          const pc = c.done / c.size;
          return (
            <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              className={`flex-1 rounded-sm bg-muted overflow-hidden cursor-pointer ring-primary ${hover === i ? "ring-1" : ""}`}>
              <div className={`h-full transition-all duration-500 ${pc >= 1 ? "bg-success" : "bg-primary"}`} style={{ width: `${pc * 100}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs">
        {d.chunks.map((c, i) => (
          <div key={i} className="rounded-md bg-background/60 border border-border px-2 py-1">
            <span className="text-muted-foreground">#{i + 1}</span>{" "}
            <span className={c.done >= c.size ? "text-success" : "text-card-foreground"}>{((c.done / c.size) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
