import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  EmptyState,
  PageHeader,
  downloadCsv,
  fmtDate,
  fmtDateTime,
  formatError,
} from "@/components/shared";
import { cn } from "@/lib/utils";

type ErrorEntry = {
  _id: string;
  message: string;
  source: string;
  functionName?: string;
  functionType?: string;
  requestId?: string;
  context?: string;
  path?: string;
  raw?: string;
  userAgent?: string;
  userName?: string;
  userEmail?: string;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  resolved?: boolean;
};

/**
 * Administrator-only view of every failed Convex request.
 *
 * Failures are captured on the client (see src/lib/error-log.ts) so this shows
 * what volunteers actually hit — including errors the app handled quietly —
 * with the reason, how often it repeats, who hit it and the Convex request id
 * that maps to the server-side stack in the Convex dashboard.
 */
export default function ErrorLogPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [fnFilter, setFnFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [range, setRange] = useState("168");
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const data = useQuery(
    api.errorLogs.list,
    isAdmin
      ? {
          search: search.trim() || undefined,
          functionName: fnFilter === "all" ? undefined : fnFilter,
          source: sourceFilter === "all" ? undefined : sourceFilter,
          hours: range === "all" ? undefined : Number(range),
          onlyUnresolved: onlyUnresolved || undefined,
        }
      : "skip",
  );

  const setResolved = useMutation(api.errorLogs.setResolved);
  const remove = useMutation(api.errorLogs.remove);
  const clear = useMutation(api.errorLogs.clear);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Error Log" code="el" />
        <EmptyState
          title="Administrators only"
          message="The error log is visible to administrators. Ask an admin if you need a failure investigated."
        />
      </div>
    );
  }

  const entries = (data?.entries ?? []) as ErrorEntry[];
  const stats = data?.stats;
  const functions = data?.filters.functions ?? [];
  const sources = data?.filters.sources ?? [];

  const toggleResolved = async (entry: ErrorEntry) => {
    try {
      await setResolved({ id: entry._id as any, resolved: !entry.resolved });
    } catch (err) {
      toast.error(formatError(err, "Could not update this entry"));
    }
  };

  const deleteEntry = async (entry: ErrorEntry) => {
    try {
      await remove({ id: entry._id as any });
      toast.success("Entry deleted");
    } catch (err) {
      toast.error(formatError(err, "Could not delete this entry"));
    }
  };

  const runClear = async (onlyResolved: boolean) => {
    try {
      const res = await clear({ onlyResolved });
      toast.success(
        res.deleted === 1 ? "1 entry cleared" : `${res.deleted} entries cleared`,
      );
      setConfirmClear(false);
    } catch (err) {
      toast.error(formatError(err, "Could not clear the log"));
    }
  };

  const copyRequestId = async (requestId: string) => {
    try {
      await navigator.clipboard.writeText(requestId);
      toast.success("Request ID copied");
    } catch {
      toast.error("Could not copy — select the text instead");
    }
  };

  const exportCsv = () => {
    if (!entries.length) return;
    downloadCsv(
      `shepherd-error-log-${new Date().toISOString().slice(0, 10)}.csv`,
      entries.map((e) => ({
        lastSeen: new Date(e.lastSeenAt).toISOString(),
        firstSeen: new Date(e.firstSeenAt).toISOString(),
        occurrences: e.occurrences,
        message: e.message,
        function: e.functionName ?? "",
        type: e.functionType ?? "",
        source: e.source,
        requestId: e.requestId ?? "",
        context: e.context ?? "",
        path: e.path ?? "",
        user: e.userEmail ?? e.userName ?? "",
        resolved: e.resolved ? "yes" : "no",
      })),
    );
  };

  const cards = [
    {
      label: "Open issues",
      value: stats ? String(stats.unresolved) : "—",
      note: stats
        ? `${stats.issues} tracked · ${stats.occurrences} total failures`
        : "Loading…",
      tone: (stats?.unresolved ?? 0) > 0 ? "text-status-red" : "text-status-green",
    },
    {
      label: "Last 24 hours",
      value: stats ? String(stats.last24h) : "—",
      note: "Issues that fired in the last day",
      tone: "text-foreground",
    },
    {
      label: "Noisiest",
      value: stats?.topFunction ? String(stats.topFunction.count) : "—",
      note: stats?.topFunction
        ? `failures from ${stats.topFunction.name}`
        : "No failures recorded",
      tone: "text-foreground",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Error Log"
        code="el"
        description="Every failed request Shepherd's users hit, with the reason and the Convex request id. Newest activity first; identical failures are grouped."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!entries.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={!stats?.issues}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear log
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {card.label}
            </p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", card.tone)}>
              {card.value}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{card.note}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-lg border bg-card p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Label htmlFor="el-search">Search</Label>
            <Input
              id="el-search"
              className="mt-1"
              value={search}
              placeholder="reason, function, email, request id…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="el-fn">Function</Label>
            <Select value={fnFilter} onValueChange={setFnFilter}>
              <SelectTrigger id="el-fn" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All functions</SelectItem>
                {functions.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="el-source">Source</Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger id="el-source" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { key: "24", label: "Last 24 hours" },
            { key: "168", label: "Last 7 days" },
            { key: "720", label: "Last 30 days" },
            { key: "all", label: "All time" },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                range === option.key
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOnlyUnresolved((v) => !v)}
            className={cn(
              "ml-auto rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
              onlyUnresolved
                ? "border-primary/50 bg-primary/10 text-primary"
                : "text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            {onlyUnresolved ? "Showing open issues only" : "Showing resolved too"}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="No failures logged"
          message={
            stats?.issues
              ? "Nothing matches these filters. Try widening the time range."
              : "Nothing has failed since the log was switched on — that's the good news."
          }
        />
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const open = expanded === entry._id;
            return (
              <div
                key={entry._id}
                className={cn(
                  "rounded-lg border bg-card p-3.5 transition-colors",
                  !entry.resolved && "border-status-red/30",
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          entry.resolved ? "bg-status-green" : "bg-status-red",
                        )}
                        title={entry.resolved ? "Resolved" : "Open"}
                      />
                      <p className="text-[13px] font-semibold break-words">{entry.message}</p>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-[11px] text-muted-foreground">
                      {entry.functionName && (
                        <code className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">
                          {entry.functionName}
                        </code>
                      )}
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {entry.source}
                      </Badge>
                      <span>
                        <b className="text-foreground">{entry.occurrences}×</b>{" "}
                        {entry.occurrences === 1 ? "time" : "times"}
                      </span>
                      <span>last {fmtDateTime(new Date(entry.lastSeenAt).toISOString())}</span>
                      {entry.firstSeenAt !== entry.lastSeenAt && (
                        <span>first {fmtDate(new Date(entry.firstSeenAt).toISOString())}</span>
                      )}
                      {(entry.userEmail || entry.userName) && (
                        <span>{entry.userEmail ?? entry.userName}</span>
                      )}
                      {entry.path && <span className="font-mono">{entry.path}</span>}
                      {entry.context && <span>{entry.context}</span>}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-4">
                      {entry.requestId && (
                        <button
                          type="button"
                          onClick={() => copyRequestId(entry.requestId!)}
                          className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          title="Copy the request id to search in the Convex dashboard"
                        >
                          <Copy className="h-2.5 w-2.5" />
                          {entry.requestId}
                        </button>
                      )}
                      {entry.raw && (
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : entry._id)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
                          />
                          {open ? "Hide details" : "Details"}
                        </button>
                      )}
                    </div>

                    {open && entry.raw && (
                      <pre className="mt-2 ml-4 max-h-48 overflow-auto rounded border border-border/60 bg-muted/30 p-2 text-[10px] leading-4 text-muted-foreground">
                        {entry.raw}
                      </pre>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleResolved(entry)}
                      title={entry.resolved ? "Reopen this issue" : "Mark as resolved"}
                    >
                      {entry.resolved ? (
                        <>
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reopen
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Resolve
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteEntry(entry)}
                      title="Delete this entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-status-amber" /> Clear the error log?
            </DialogTitle>
            <DialogDescription>
              Deleting entries removes the evidence of what broke — export the CSV
              first if you may need it. Resolved issues are usually safe to clear.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-3 text-[12px] text-muted-foreground">
            <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" />
            {stats?.issues ?? 0} tracked issues · {stats?.unresolved ?? 0} still open
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => runClear(true)}>
              Clear resolved
            </Button>
            <Button variant="destructive" onClick={() => runClear(false)}>
              Clear everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
