import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  PageHeader,
  canPublishPosts,
  fmtDate,
  fmtDateTime,
} from "@/components/shared";
import { PostComposerDialog } from "@/components/post-composer";
import { cn } from "@/lib/utils";
import {
  Download,
  ExternalLink,
  FileWarning,
  History,
  ScrollText,
  Upload,
} from "lucide-react";

type ConstitutionMedia = {
  storageId: string;
  type: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  duration: number | null;
  url: string | null;
};

type ConstitutionDoc = {
  _id: string;
  title: string;
  body: string;
  author: string | null;
  createdAt: number;
  updatedAt: number;
  media: ConstitutionMedia[];
};

/** Does this attachment behave like a document a browser can open as a PDF? */
function isPdf(m: ConstitutionMedia) {
  return (
    m.type === "file" &&
    ((m.mimeType ?? "").toLowerCase().includes("pdf") ||
      m.name.toLowerCase().endsWith(".pdf"))
  );
}

/**
 * The youth constitution.
 *
 * The constitution is published as an announcement filed under the
 * "constitution" category, and this page is the reader: it opens the newest
 * version of the document itself — full width, in the page — instead of showing
 * a file chip that has to be downloaded first. Earlier versions stay one tap
 * away, so a reader can check what the constitution said before an amendment.
 */
export default function Constitution() {
  const data = useQuery(api.posts.constitution);
  const me = useQuery(api.users.currentUser);
  // Publishing a version is the same action as any other announcement, so the
  // same people may do it from here.
  const canPublish = canPublishPosts(me);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const docs: ConstitutionDoc[] = data
    ? ([data.current, ...data.versions].filter(Boolean) as ConstitutionDoc[])
    : [];
  const doc = docs.find((d) => d._id === selectedId) ?? docs[0] ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Youth Constitution"
        code="cn"
        actions={
          canPublish ? (
            <Button variant="outline" onClick={() => setComposerOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" />
              {doc ? "Publish a new version" : "Publish the constitution"}
            </Button>
          ) : null
        }
      />

      {data === undefined ? (
        <div className="h-[60vh] animate-pulse rounded-xl border bg-card" />
      ) : !doc ? (
        <EmptyState
          title="The constitution isn't published yet"
          message="Once leadership publishes the youth constitution — the text itself, or the signed document — it opens right here for every member of the team. It is filed under the Constitution category, so it is never mixed in with ordinary announcements."
          action={
            canPublish ? (
              <Button onClick={() => setComposerOpen(true)}>
                <Upload className="mr-1.5 h-4 w-4" />
                Publish the constitution
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link to="/announcements?category=constitution">
                  See constitution posts
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Earlier versions: the newest is what opens, but an amendment is
              only meaningful next to what it replaced. */}
          {docs.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Versions
              </span>
              {docs.map((d, i) => {
                const active = d._id === doc._id;
                return (
                  <button
                    key={d._id}
                    type="button"
                    onClick={() => setSelectedId(d._id)}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[10px] font-semibold transition-colors",
                      active
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-primary",
                    )}
                  >
                    {i === 0 ? "Current" : fmtDate(new Date(d.createdAt).toISOString())}
                  </button>
                );
              })}
            </div>
          )}

          <ConstitutionDocument doc={doc} />

          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span>
              Filed under{" "}
              <Link
                to="/announcements?category=constitution"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Constitution
              </Link>{" "}
              in Announcements.
            </span>
            {doc.author && <span>· Published by {doc.author}</span>}
          </p>
        </>
      )}

      <PostComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        initialCategory="constitution"
      />
    </div>
  );
}

/**
 * One version of the constitution, drawn as a document rather than a file card.
 *
 * A PDF (or an image of the signed copy) opens in the page itself, with the
 * original one click away in a new tab. If the version was posted as text, the
 * text is typeset here instead, so the page always reads as the constitution
 * and never as "download this".
 */
function ConstitutionDocument({ doc }: { doc: ConstitutionDoc }) {
  const pdf = doc.media.find(isPdf);
  const image = doc.media.find((m) => m.type === "image");
  const other = doc.media.find((m) => m.type !== "image" && !isPdf(m));
  const primary = pdf ?? image ?? other ?? null;
  const extras = doc.media.filter((m) => m !== primary);
  const title = doc.title.trim() || "Youth Constitution";

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
            <ScrollText className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-bold tracking-tight">
              {title}
            </h2>
            <p className="text-[10px] text-muted-foreground">
              Published {fmtDateTime(new Date(doc.createdAt).toISOString())}
              {doc.updatedAt > doc.createdAt &&
                ` · edited ${fmtDate(new Date(doc.updatedAt).toISOString())}`}
              {primary && ` · ${primary.name}`}
            </p>
          </div>
        </div>
        {primary?.url && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-[11px]" asChild>
              <a href={primary.url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3 w-3" />
                Open
              </a>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" asChild>
              <a href={primary.url} download={primary.name}>
                <Download className="mr-1 h-3 w-3" />
                Download
              </a>
            </Button>
          </div>
        )}
      </header>

      {pdf?.url ? (
        // The browser's own PDF reader, filling the page. If a particular
        // browser refuses to render it inline, the Open/Download buttons above
        // are the way through.
        <iframe
          src={`${pdf.url}#view=FitH`}
          title={title}
          className="h-[72vh] min-h-[460px] w-full border-0 bg-white"
        />
      ) : image?.url ? (
        <div className="bg-muted/20 p-4 sm:p-6">
          <img
            src={image.url}
            alt={title}
            className="mx-auto max-h-[78vh] w-auto rounded-md border bg-white object-contain"
          />
        </div>
      ) : doc.body.trim() ? (
        <article className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="mx-auto max-w-2xl">
            <p className="term-label mb-4">// the constitution</p>
            <div className="whitespace-pre-wrap text-[13.5px] leading-7 text-foreground/90">
              {doc.body}
            </div>
          </div>
        </article>
      ) : other ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <FileWarning className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="text-sm font-semibold">This document can't be shown in the page</p>
          <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
            {other.name} needs an app that can open it. Use Open above to read it
            without leaving Shepherd.
          </p>
          {other.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={other.url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open document
              </a>
            </Button>
          )}
        </div>
      ) : (
        <div className="px-6 py-14 text-center text-[11px] text-muted-foreground">
          This version has no document attached yet.
        </div>
      )}

      {extras.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Also attached
          </span>
          {extras.map((m) =>
            m.url ? (
              <a
                key={m.storageId}
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-primary underline underline-offset-2 hover:text-primary/80"
              >
                {m.name}
              </a>
            ) : (
              <span key={m.storageId} className="text-[10px] text-muted-foreground">
                {m.name}
              </span>
            ),
          )}
        </footer>
      )}
    </section>
  );
}
