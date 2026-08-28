/**
 * Shared shapes for the documentation content.
 *
 * Kept in their own module so the product docs and the developer docs can
 * both import them without either file depending on the other.
 */

export type DocBlock =
  | { type: "p"; text: string }
  | { type: "h3"; text: string; id?: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "code"; lang?: string; code: string; caption?: string }
  | { type: "note"; tone: "info" | "warn" | "good"; title?: string; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "steps"; items: { title: string; text: string }[] }
  | { type: "kv"; rows: { k: string; v: string; href?: string }[] };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  sections: DocSection[];
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}

