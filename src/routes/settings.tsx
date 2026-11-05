import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { FolderOpen, Puzzle } from "lucide-react";
import { AppHeader } from "@/components/ddm/AppHeader";
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
  useEffect(() => {
    if (externalUrl) void navigate({ to: "/" });
  }, [externalUrl, navigate]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-4">
        <h1 className="text-2xl font-semibold text-card-foreground">Preferences</h1>

        <Card title="Default download directory">
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <input
              value={settings.defaultDir}
              onChange={(e) => setSettings({ defaultDir: e.target.value })}
              className="flex-1 bg-transparent py-2 font-mono text-sm outline-none"
            />
          </div>
        </Card>

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
