// Sentence / paragraph segmentation and protected-span masking.
// Pure functions. Nothing here stores or transmits text.

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "engr", "atty", "arch", "sen", "rep", "gov", "gen", "hon", "rev",
  "sr", "jr", "st", "vs", "inc", "ltd", "co", "corp", "dept", "fig", "approx", "est", "no", "nos",
  "e.g", "i.e", "cf", "al", "ph.d", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
  "oct", "nov", "dec", "mt", "ave", "blvd", "brgy", "sec", "vol", "pp", "ed", "eds"
]);

/** Split a paragraph into sentence pieces. Joining the pieces returns the paragraph exactly. */
export function splitSentences(paragraph: string): string[] {
  const attempt = (trackQuotes: boolean): string[] | null => {
    const pieces: string[] = [];
    let start = 0;
    let open = false;
    const re = /[.!?…]+["'”’)\]]*(\s+)|["“”]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(paragraph))) {
      if (!m[1]) {
        if (trackQuotes) {
          const ch = m[0];
          if (ch === "“") open = true; else if (ch === "”") open = false; else open = !open;
        }
        continue;
      }
      if (open) continue;
      const end = m.index + m[0].length;
      const next = paragraph.slice(end, end + 2);
      if (!/^[A-Z0-9“"'‘(\[]/.test(next)) continue;
      const head = paragraph.slice(start, m.index + m[0].length - m[1].length);
      const wordMatch = head.match(/([A-Za-z][A-Za-z.]*)[.!?…]+["'”’)\]]*$/);
      const last = wordMatch ? wordMatch[1].toLowerCase().replace(/\.$/, "") : "";
      const isInitial = /(?:^|\s)[A-Z]\.$/.test(head.trimEnd());
      if (m[0].startsWith(".") && !/^[.]{2,}/.test(m[0])) {
        if (isInitial) continue;
        if (ABBREVIATIONS.has(last)) {
          if (last === "no" || last === "nos") { if (/^\d/.test(next)) continue; }
          else if (last !== "co" || /^[a-z]/.test(next)) continue;
        }
      }
      pieces.push(paragraph.slice(start, end));
      start = end;
    }
    if (trackQuotes && open) return null;
    if (start < paragraph.length) pieces.push(paragraph.slice(start));
    return pieces;
  };
  return attempt(true) ?? attempt(false)!;
}

export interface Block { text: string; separator: boolean }

/** Split text into blank-line separated blocks, keeping separators so output re-joins losslessly. */
export function splitBlocks(text: string): Block[] {
  return text.split(/(\n[ \t]*\n[\s]*)/).map((part, i) => ({ text: part, separator: i % 2 === 1 }));
}

const LIST_MARKER = /^(\s*(?:[-*•–—]|\d{1,3}[.)]|[A-Za-z][.)]|\(\w{1,3}\))\s+)/;

export function listPrefix(line: string): string {
  const m = line.match(LIST_MARKER);
  return m ? m[1] : "";
}

/** Short Title Case / UPPERCASE / colon-terminated lines are treated as headings and left alone. */
export function isHeadingLike(line: string): boolean {
  const body = line.trim();
  if (!body) return true;
  if (body.includes("\t")) return true;
  const words = body.split(/\s+/);
  if (/:$/.test(body) && words.length <= 10) return true;
  if (/[.!?,;]["”’)]?$/.test(body)) return false;
  if (words.length > 8) return false;
  const small = new Set(["a", "an", "the", "of", "and", "or", "in", "on", "to", "for", "with", "at", "by", "from", "vs", "as", "is", "are"]);
  return words.every(w => /^[^a-z]/.test(w) || small.has(w.toLowerCase()) || /^\d/.test(w));
}

// Protected spans: quotations, URLs, e-mail, code, @mentions/#tags. Masked with opaque tokens so
// rules can never edit them and so word-boundary logic treats them as non-words.
const PROTECT = /"[^"\n]{1,600}"|“[^”\n]{1,600}”|`[^`\n]+`|https?:\/\/[^\s)]+|www\.[^\s)]+|[\w.+-]+@[\w-]+\.[\w.-]+|[@#][\w-]+/g;

export interface Masked { masked: string; spans: string[]; restore: (s: string) => string }

export function maskProtected(text: string): Masked {
  const spans: string[] = [];
  const masked = text.replace(PROTECT, m => { spans.push(m); return `\uE000${spans.length - 1}\uE001`; });
  const restore = (s: string) => s.replace(/\uE000(\d+)\uE001/g, (_, i) => spans[Number(i)] ?? "");
  return { masked, spans, restore };
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}
