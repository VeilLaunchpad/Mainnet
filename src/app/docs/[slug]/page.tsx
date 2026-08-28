import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DocsShell } from "@/components/docs-shell";
import { DOC_PAGES, docBySlug, adjacentDocs } from "@/lib/docs";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = docBySlug(slug);
  if (!page) return { title: "Docs" };
  return { title: page.title, description: page.description };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docBySlug(slug);
  if (!page) notFound();

  const { prev, next } = adjacentDocs(slug);
  return <DocsShell page={page} prev={prev} next={next} />;
}
