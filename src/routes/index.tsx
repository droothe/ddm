import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { AppHeader } from "@/components/ddm/AppHeader";
import { AddDownloadModal } from "@/components/ddm/AddDownloadModal";
import { DownloadRow } from "@/components/ddm/DownloadRow";
import { useDDM, type Status } from "@/lib/ddm-store";
import type { TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Downloads — Droothe Download Manager" },
      {
        name: "description",
        content: "Multi-thread download dashboard with live speed, ETA and segment visualizer.",
      },
      { property: "og:title", content: "Downloads — Droothe Download Manager" },
      {
        property: "og:description",
        content: "Multi-thread download dashboard with live speed, ETA and segment visualizer.",
      },
    ],
  }),
  component: Dashboard,
});

const FILTERS: { key: "all" | Status; label: TranslationKey }[] = [
  { key: "all", label: "all" },
  { key: "downloading", label: "active" },
  { key: "paused", label: "paused" },
  { key: "completed", label: "completed" },
  { key: "error", label: "error" },
];

function Dashboard() {
  const { downloads, pauseAll, resumeAll, externalUrl, clearExternalUrl, t } = useDDM();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | Status>("all");
  useEffect(() => {
    if (externalUrl) setOpen(true);
  }, [externalUrl]);
  const list =
    filter === "all"
      ? downloads
      : downloads.filter(
          (d) =>
            d.status === filter ||
            (filter === "downloading" && (d.status === "merging" || d.status === "queued")),
        );

  return (
    <>
      <AppHeader onAdd={() => setOpen(true)} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-sm ${filter === f.key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 text-sm">
            <button
              onClick={resumeAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-primary"
            >
              <Play className="h-4 w-4" />
              {t("resumeAll")}
            </button>
            <button
              onClick={pauseAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-warning"
            >
              <Pause className="h-4 w-4" />
              {t("pauseAll")}
            </button>
          </div>
        </div>
        <div className="space-y-3">
          {list.map((d) => (
            <DownloadRow key={d.id} d={d} />
          ))}
          {list.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
              {t("noDownloads")}
            </div>
          )}
        </div>
      </main>
      <AddDownloadModal
        open={open}
        {...(externalUrl ? { initialUrl: externalUrl } : {})}
        onClose={() => {
          setOpen(false);
          clearExternalUrl();
        }}
      />
    </>
  );
}
