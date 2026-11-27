import { useState } from "react";
import { ChevronDown, FolderOpen, Pause, Play, Trash2, X } from "lucide-react";
import {
  bytesDone,
  fmtBytes,
  fmtEta,
  fmtSpeed,
  progress,
  useDDM,
  type Download,
  type Status,
} from "@/lib/ddm-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TranslationKey } from "@/lib/i18n";
import { CategoryIcon } from "./CategoryIcon";

const STATUS: Record<Status, { label: TranslationKey; cls: string; bar: string }> = {
  downloading: {
    label: "statusDownloading",
    cls: "text-primary border-primary/40",
    bar: "bg-primary",
  },
  paused: { label: "statusPaused", cls: "text-warning border-warning/40", bar: "bg-warning" },
  completed: {
    label: "statusCompleted",
    cls: "text-success border-success/40",
    bar: "bg-success",
  },
  merging: { label: "statusMerging", cls: "text-merge border-merge/40", bar: "bg-merge" },
  error: {
    label: "statusError",
    cls: "text-destructive border-destructive/40",
    bar: "bg-destructive",
  },
  queued: {
    label: "statusQueued",
    cls: "text-muted-foreground border-border",
    bar: "bg-muted-foreground",
  },
  cancelled: {
    label: "statusCancelled",
    cls: "text-muted-foreground border-border",
    bar: "bg-muted-foreground",
  },
};

export function DownloadRow({ d }: { d: Download }) {
  const { pause, resume, cancel, remove, openFolder: revealFolder, settings, t } = useDDM();
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toast, setToast] = useState("");
  const p = progress(d);
  const s = STATUS[d.status];
  const done = bytesDone(d);

  const openFolder = () => {
    void revealFolder(d.id)
      .then(() => setToast(t("openedFolder", { path: d.path })))
      .catch((error: unknown) =>
        setToast(error instanceof Error ? error.message : t("couldNotOpenDownloadFolder")),
      );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-3 min-w-0 md:w-[32%]">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-accent text-accent-foreground grid place-items-center">
            <CategoryIcon category={d.category} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-card-foreground" title={d.name}>
              {d.name}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {fmtBytes(done)} / {fmtBytes(d.size)}
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div className="flex justify-between text-xs mb-1.5">
            <span className={`rounded-full border px-2 py-0.5 ${s.cls}`}>{t(s.label)}</span>
            <span className="font-mono text-card-foreground">{(p * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${s.bar} ${d.status === "downloading" || d.status === "merging" ? "stripes" : ""}`}
              style={{ width: `${p * 100}%` }}
            />
          </div>
          <div className="mt-1.5 flex gap-4 text-xs font-mono text-muted-foreground">
            <span>{d.status === "downloading" ? fmtSpeed(d.speed, true) : "0.00 MB/s"}</span>
            <span>
              {t("eta")}{" "}
              {d.status === "downloading" ? fmtEta(d.size - done, d.speed, settings.language) : "—"}
            </span>
            <span>{t("threadCount", { count: d.threads })}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {d.status === "downloading" || d.status === "queued" ? (
            <Btn label={t("pause")} onClick={() => pause(d.id)}>
              <Pause className="h-4 w-4" />
            </Btn>
          ) : (d.status === "paused" || d.status === "error") && d.prepared ? (
            <Btn label={t("resume")} onClick={() => resume(d.id)}>
              <Play className="h-4 w-4" />
            </Btn>
          ) : null}
          {d.status !== "completed" && d.status !== "cancelled" && (
            <Btn label={t("cancel")} onClick={() => cancel(d.id)}>
              <X className="h-4 w-4" />
            </Btn>
          )}
          <Btn label={t("openFolder")} onClick={openFolder}>
            <FolderOpen className="h-4 w-4" />
          </Btn>
          <Btn label={t("delete")} danger onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Btn>
          <Btn label={t("segments")} onClick={() => setOpen((o) => !o)}>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Btn>
        </div>
      </div>
      {d.errorMessage && <p className="mt-2 text-sm text-destructive">{d.errorMessage}</p>}
      {toast && <div className="mt-2 text-xs text-primary font-mono">{toast}</div>}
      {open && <SegmentVisualizer d={d} />}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => remove(d.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Btn({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-2 rounded-md text-muted-foreground hover:bg-muted ${danger ? "hover:text-destructive" : "hover:text-primary"}`}
    >
      {children}
    </button>
  );
}

function SegmentVisualizer({ d }: { d: Download }) {
  const { t } = useDDM();
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex justify-between text-xs text-muted-foreground mb-2">
        <span className="uppercase tracking-wider">{t("httpRangeSegments")}</span>
        <span className="font-mono">
          {hover !== null && d.chunks[hover]
            ? t("chunkProgress", {
                number: hover + 1,
                percent: ((d.chunks[hover]!.done / d.chunks[hover]!.size) * 100).toFixed(1),
              })
            : t("hoverAChunk")}
        </span>
      </div>
      <div className="flex gap-1 h-6">
        {d.chunks.map((c, i) => {
          const pc = c.size > 0 ? Math.min(1, c.done / c.size) : 0;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={`flex-1 rounded-sm bg-muted overflow-hidden ring-primary ${hover === i ? "ring-1" : ""}`}
            >
              <div
                className={`h-full transition-all duration-500 ${pc >= 1 ? "bg-success" : "bg-primary"}`}
                style={{ width: `${pc * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs">
        {d.chunks.map((c, i) => (
          <div key={i} className="rounded-md bg-background/60 border border-border px-2 py-1">
            <span className="text-muted-foreground">#{i + 1}</span>{" "}
            <span className={c.done >= c.size ? "text-success" : "text-card-foreground"}>
              {(c.size > 0 ? (c.done / c.size) * 100 : 0).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
