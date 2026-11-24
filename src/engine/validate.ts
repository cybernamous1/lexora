// Meaning-preservation checks. A transformed sentence is accepted only if it passes all of them;
// otherwise the engine falls back to a safer stage or to the original sentence.
import { words } from "./sentences.ts";

const MODALS = new Set(["can", "could", "will", "would", "shall", "should", "may", "might", "must"]);
const QUANT = new Set(["all", "every", "always", "only", "most", "some", "never", "few", "none", "both", "either", "neither"]);
const NEGATIONS = new Set(["not", "no", "never", "none", "nobody", "nothing", "neither", "nor"]);

function tokens(s: string): string[] {
  const expanded = s.toLowerCase()
    .replace(/won['’]t/g, "will not").replace(/can['’]t/g, "can not").replace(/cannot/g, "can not")
    .replace(/shan['’]t/g, "shall not").replace(/n['’]t\b/g, " not")
    .replace(/['’]ll\b/g, " will").replace(/['’]ve\b/g, " have").replace(/['’]re\b/g, " are").replace(/['’]m\b/g, " am");
  return words(expanded);
}
const count = (toks: string[], set: Set<string>) => toks.filter(t => set.has(t)).length;
function countOf(toks: string[], word: string) { return toks.filter(t => t === word).length; }
const nums = (s: string) => (s.match(/\d[\d,.]*\d|\d/g) ?? []).map(n => n.replace(/[,.]+$/, "")).sort().join("|");
const balance = (s: string, a: string, b: string) => s.split(a).length - s.split(b).length;

export function validateSentence(original: string, output: string): boolean {
  if (!output.trim() || /[\uE000\uE001]/.test(output)) return false;
  if (nums(original) !== nums(output)) return false;
  const a = tokens(original), b = tokens(output);
  if (count(a, NEGATIONS) !== count(b, NEGATIONS)) return false;
  for (const m of MODALS) if (countOf(b, m) < countOf(a, m)) return false;
  for (const q of QUANT) if (countOf(b, q) < countOf(a, q)) return false;
  // Proper nouns / acronyms (capitalised words after the first) must survive unchanged.
  const caps = original.replace(/^\W*\S+/, "").replace(/([:;]\s+)[A-Za-z'’]+/g, "$1").match(/\b[A-Z][A-Za-z-]{1,}\b(?!['’])/g) ?? [];
  for (const c of caps) if (!output.includes(c)) return false;
  for (const q of original.match(/"[^"\n]+"|“[^”\n]+”/g) ?? []) if (!output.includes(q)) return false;
  if (balance(original, "(", ")") !== balance(output, "(", ")")) return false;
  const wa = words(original).length, wb = words(output).length;
  if (wb < Math.floor(wa * 0.4) || wb > wa * 1.3 + 3) return false;
  if (/[.!?]["”’)]*$/.test(original.trim()) && !/[.!?]["”’)]*$/.test(output.trim())) return false;
  return true;
}
