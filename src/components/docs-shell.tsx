"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DOC_GROUPS, searchIndex, type DocBlock, type DocPage } from "@/lib/docs";

/**
 * GitBook-shaped documentation: a grouped sidebar on the left, the page in the
 * middle, and an on-this-page rail on the right. All three are derived from the
 * same typed content so they cannot drift apart.
 */
export function DocsShell({ page, prev, next }: { page: DocPage; prev: DocPage | null; next: DocPage | null }) {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)_190px]">
      <Sidebar current={page.slug} />

      <article className="min-w-0">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-devox-400">
          Documentation
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-white/50">{page.description}</p>

        <div className="mt-8 space-y-10">
          {page.sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
              <div className="mt-3 space-y-3.5">
                {s.blocks.map((b, i) => (
                  <Block key={i} block={b} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <nav className="mt-14 grid gap-3 border-t border-white/[0.06] pt-6 sm:grid-cols-2">
          {prev ? (
            <Link
              href={"/docs/" + prev.slug}
              className="card card-hover p-4 text-left"
            >
              <div className="text-[11px] text-white/35">Previous</div>
              <div className="mt-0.5 text-[14px] font-semibold">{prev.title}</div>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={"/docs/" + next.slug}
              className="card card-hover p-4 text-right sm:col-start-2"
            >
              <div className="text-[11px] text-white/35">Next</div>
              <div className="mt-0.5 text-[14px] font-semibold">{next.title}</div>
            </Link>
          )}
        </nav>
      </article>

      <OnThisPage page={page} />
    </div>
  );
}

function Sidebar({ current }: { current: string }) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => searchIndex(), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(index.filter((e) => e.text.includes(q)).map((e) => e.slug));
  }, [query, index]);

  return (
    <aside className="lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)] lg:overflow-y-auto">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search docs"
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] outline-none transition placeholder:text-white/25 focus:border-devox-400/50"
      />

      <nav className="mt-4 space-y-5">
        {DOC_GROUPS.map((group) => {
          const pages = matches ? group.pages.filter((p) => matches.has(p.slug)) : group.pages;
          if (!pages.length) return null;
          return (
            <div key={group.title}>
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                {group.title}
              </div>
              <ul className="space-y-0.5">
                {pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={"/docs/" + p.slug}
                      className={
                        "block rounded-lg px-2 py-1.5 text-[13px] transition " +
                        (current === p.slug
                          ? "bg-devox-500/12 font-medium text-devox-200"
                          : "text-white/55 hover:bg-white/[0.04] hover:text-white")
                      }
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {matches && matches.size === 0 && (
          <p className="px-2 text-[12px] text-white/30">Nothing matches that.</p>
        )}
      </nav>
    </aside>
  );
}

function OnThisPage({ page }: { page: DocPage }) {
  const anchors = page.sections.flatMap((s) => [
    { id: s.id, label: s.title, sub: false },
    ...s.blocks
      .filter((b): b is Extract<DocBlock, { type: "h3" }> => b.type === "h3" && !!b.id)
      .map((b) => ({ id: b.id!, label: b.text, sub: true })),
  ]);

  return (
    <aside className="hidden lg:sticky lg:top-20 lg:block lg:h-fit">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
        On this page
      </div>
      <ul className="space-y-1 border-l border-white/[0.08]">
        {anchors.map((a) => (
          <li key={a.id}>
            <a
              href={"#" + a.id}
              className={
                "-ml-px block border-l border-transparent py-0.5 text-[12px] leading-snug text-white/45 transition hover:border-devox-400 hover:text-white " +
                (a.sub ? "pl-5" : "pl-3")
              }
            >
              {a.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Block({ block: b }: { block: DocBlock }) {
  if (b.type === "p") {
    return <p className="text-[14px] leading-[1.75] text-white/65">{b.text}</p>;
  }

  if (b.type === "h3") {
    return (
      <h3 id={b.id} className="scroll-mt-20 pt-3 text-[15px] font-semibold text-white">
        {b.text}
      </h3>
    );
  }

  if (b.type === "list") {
    const Tag = b.ordered ? "ol" : "ul";
    return (
      <Tag className="space-y-1.5">
        {b.items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-[1.7] text-white/65">
            {b.ordered ? (
              <span className="mono mt-0.5 shrink-0 text-[11px] text-devox-400">{i + 1}.</span>
            ) : (
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-devox-400/70" />
            )}
            <span>{item}</span>
          </li>
        ))}
      </Tag>
    );
  }

  if (b.type === "code") {
    return (
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/40">
        {b.caption && (
          <div className="border-b border-white/[0.06] px-3.5 py-1.5 text-[10px] uppercase tracking-wider text-white/35">
            {b.caption}
          </div>
        )}
        <pre className="mono overflow-x-auto px-3.5 py-3 text-[12px] leading-relaxed text-cy-300">
          {b.code}
        </pre>
      </div>
    );
  }

  if (b.type === "note") {
    const tones = {
      info: "border-cy-400/25 bg-cy-500/[0.06] text-cy-300",
      warn: "border-amber-400/25 bg-amber-400/[0.05] text-amber-300",
      good: "border-mint-400/25 bg-mint-400/[0.05] text-mint-400",
    };
    return (
      <div className={"rounded-xl border p-3.5 " + tones[b.tone]}>
        {b.title && <div className="text-[12px] font-semibold">{b.title}</div>}
        <p className={"text-[13px] leading-relaxed text-white/70 " + (b.title ? "mt-1" : "")}>
          {b.text}
        </p>
      </div>
    );
  }

  if (b.type === "table") {
    return (
      <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
        <table className="w-full min-w-[440px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              {b.head.map((h) => (
                <th key={h} className="px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.05] last:border-0">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={
                      "px-3.5 py-2 align-top leading-relaxed " +
                      (j === 0 ? "mono whitespace-nowrap text-white/80" : "text-white/55")
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (b.type === "steps") {
    return (
      <ol className="space-y-3">
        {b.items.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="mono mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-devox-400/30 bg-devox-500/10 text-[11px] font-semibold text-devox-300">
              {i + 1}
            </span>
            <div>
              <div className="text-[14px] font-semibold text-white">{s.title}</div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-white/55">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (b.type === "kv") {
    return (
      <dl className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.08]">
        {b.rows.map((r) => (
          <div key={r.k} className="flex flex-wrap gap-x-4 gap-y-1 px-3.5 py-2.5">
            <dt className="mono w-[150px] shrink-0 text-[12px] text-devox-300">{r.k}</dt>
            <dd className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/60">{r.v}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return null;
}
