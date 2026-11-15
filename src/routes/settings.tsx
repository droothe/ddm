import { isTauri } from "@tauri-apps/api/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FolderOpen, Puzzle } from "lucide-react";
import { AppHeader } from "@/components/ddm/AppHeader";
import {
  chooseDownloadDirectory,
  getDefaultDownloadDirectory,
  isAndroidTauriRuntime,
} from "@/lib/downloadEngine";
import { useDDM } from "@/lib/ddm-store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Droothe Download Manager" },
      {
        name: "description",
        content: "Configure download directory, concurrency, threads and browser extension.",
      },
      { property: "og:title", content: "Settings — Droothe Download Manager" },
      {
        property: "og:description",
        content: "Configure download directory, concurrency, threads and browser extension.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, setSettings, extension, externalUrl } = useDDM();
  const navigate = useNavigate();
  const [systemDownloadDirectory, setSystemDownloadDirectory] = useState("Downloads");
  const [directoryError, setDirectoryError] = useState("");
  const isDesktopTauri = isTauri() && !isAndroidTauriRuntime();

  useEffect(() => {
    if (externalUrl) void navigate({ to: "/" });
  }, [externalUrl, navigate]);

  useEffect(() => {
    if (!isDesktopTauri) return;
    void getDefaultDownloadDirectory()
      .then((directory) => {
        if (directory) setSystemDownloadDirectory(directory);
      })
      .catch((error: unknown) => {
        console.error("Could not read the system Downloads directory.", error);
        setDirectoryError(
          error instanceof Error ? error.message : "Could not read the system Downloads directory.",
        );
      });
  }, [isDesktopTauri]);

  const browseDirectory = async () => {
    setDirectoryError("");
    try {
      const directory = await chooseDownloadDirectory(
        settings.defaultDir || systemDownloadDirectory,
      );
      if (directory) setSettings({ defaultDir: directory });
    } catch (error) {
      setDirectoryError(
        error instanceof Error ? error.message : "Could not open the folder picker.",
      );
    }
  };

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-4">
        <h1 className="text-2xl font-semibold text-card-foreground">Preferences</h1>

        <Card title="Default download directory">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                aria-label="Default download directory"
                readOnly
                value={settings.defaultDir || systemDownloadDirectory}
                className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void browseDirectory()}
              disabled={!isDesktopTauri}
              className="rounded-md border border-input px-3 text-sm text-muted-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Browse...
            </button>
          </div>
          {directoryError && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {directoryError}
            </p>
          )}
        </Card>

        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-5">
          <div>
            <div className="font-medium text-card-foreground">Ask where to save each file</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Show a native save dialog before starting each download.
              {!isDesktopTauri && " Available in the desktop app."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Ask where to save each file"
            aria-checked={settings.askWhereToSave}
            disabled={!isDesktopTauri}
            onClick={() => setSettings({ askWhereToSave: !settings.askWhereToSave })}
            className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              settings.askWhereToSave ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
                settings.askWhereToSave ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <Card title="Concurrent downloads limit" value={String(settings.maxConcurrent)}>
          <input
            type="range"
            min={1}
            max={10}
            value={settings.maxConcurrent}
            onChange={(e) => setSettings({ maxConcurrent: +e.target.value })}
            className="w-full accent-primary"
          />
        </Card>

        <Card title="Default threads per download" value={String(settings.defaultThreads)}>
          <input
            type="range"
            min={1}
            max={16}
            value={settings.defaultThreads}
            onChange={(e) => setSettings({ defaultThreads: +e.target.value })}
            className="w-full accent-primary"
          />
        </Card>

        <Card
          title="Global speed limit"
          value={settings.speedLimitMB ? `${settings.speedLimitMB} MB/s` : "Unlimited"}
        >
          <input
            type="range"
            min={0}
            max={50}
            value={settings.speedLimitMB}
            onChange={(e) => setSettings({ speedLimitMB: +e.target.value })}
            className="w-full accent-primary"
          />
        </Card>

        <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
          <div className="h-10 w-10 rounded-lg bg-accent text-accent-foreground grid place-items-center">
            <Puzzle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-card-foreground">Chrome Extension</div>
            <div className="text-sm text-muted-foreground">
              Accepts links posted by an extension to this app using the{" "}
              <code>ddm:add-download</code> message.
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
            <span
              className={`h-2 w-2 rounded-full ${extension === "listening" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`}
            />
            Listener: {extension === "listening" ? "Listening" : "Unavailable"}
          </div>
        </div>
      </main>
    </>
  );
}

function Card({
  title,
  value,
  children,
}: {
  title: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex justify-between mb-3">
        <span className="font-medium text-card-foreground">{title}</span>
        {value && <span className="font-mono text-primary">{value}</span>}
      </div>
      {children}
    </div>
  );
}
