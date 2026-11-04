import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Cpu, Plus, Settings, LayoutGrid } from "lucide-react";
import { fmtSpeed, useDDM } from "@/lib/ddm-store";

export function AppHeader({ onAdd }: { onAdd?: () => void }) {
  const { stats } = useDDM();
  return (
    <header className="border-b border-border bg-card/70 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-7xl px-4 py-4 flex flex-wrap items-center gap-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold glow">D</div>
          <div>
            <div className="font-semibold text-card-foreground leading-tight">Droothe Download Manager</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Engine: Active / Multi-thread
            </div>
          </div>
        </Link>

        <div className="order-3 w-full md:order-none md:w-auto md:ml-auto grid grid-cols-3 gap-2 font-mono text-xs">
          <Stat icon={<ArrowDown className="h-3.5 w-3.5" />} label="Down" value={fmtSpeed(stats.down)} accent />
          <Stat icon={<ArrowUp className="h-3.5 w-3.5" />} label="Up" value={fmtSpeed(stats.up)} />
          <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="Threads" value={String(stats.threads)} />
        </div>

        <nav className="ml-auto md:ml-0 flex items-center gap-2">
          <Link to="/" className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" activeProps={{ className: "text-primary" }} aria-label="Dashboard">
            <LayoutGrid className="h-4 w-4" />
          </Link>
          <Link to="/settings" className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted" activeProps={{ className: "text-primary" }} aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Link>
          {onAdd && (
            <button onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 glow">
              <Plus className="h-4 w-4" /> Add New Download
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/60 px-3 py-1.5 min-w-[110px]">
      <div className="flex items-center gap-1 text-muted-foreground">{icon}{label}</div>
      <div className={accent ? "text-primary font-semibold" : "text-card-foreground font-semibold"}>{value}</div>
    </div>
  );
}
