import { splitBlocks, splitSentences, words } from "./sentences.ts";

export interface Analysis {
  sentences: number;
  words: number;
  avgWordsPerSentence: number;
  longSentences: number;
  repeatedTransitions: number;
  passiveLike: number;
  paragraphCount: number;
  // Added in engine v2
  readingEase: number;      // Flesch Reading Ease (higher = easier)
  gradeLevel: number;       // Flesch-Kincaid grade
  repeatedOpeners: number;  // runs of 3+ sentences starting with the same word
  stockPhrases: number;     // wordy / stock phrases from a fixed list
  shortRuns: number;        // runs of 4+ very short sentences in a row
}

const TRANSITIONS = [
  "furthermore", "moreover", "additionally", "consequently", "therefore", "in conclusion", "in summary",
  "in addition", "however", "thus", "hence", "overall", "also"
];

const STOCK_PHRASES = [
  "plays a crucial role", "plays a vital role", "plays a key role", "plays an important role", "in today's world",
  "in this day and age", "delve into", "a testament to", "tapestry", "navigate the complexities", "ever-evolving",
  "fast-paced world", "it is worth noting", "in the realm of", "game-changer", "paradigm shift", "unlock the potential",
  "embark on a journey", "it goes without saying", "needless to say"
];

const IRREGULAR_PP = "been|begun|born|broken|brought|built|bought|chosen|done|drawn|driven|eaten|fallen|felt|found|given|gone|grown|held|hidden|kept|known|laid|led|left|lost|made|meant|met|paid|put|read|run|said|seen|sent|set|shown|sold|spoken|taken|taught|told|thought|understood|won|written";
const PASSIVE = new RegExp(`\\b(?:is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(?:\\w{3,}ed|${IRREGULAR_PP})\\b`, "gi");

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function analyzeText(input: string): Analysis {
  const text = input.trim();
  const allWords = words(text);
  const paragraphs = text ? splitBlocks(text).filter(b => !b.separator && b.text.trim()) : [];
  let sentenceCount = 0, longSentences = 0, repeatedOpeners = 0, shortRuns = 0;
  for (const p of paragraphs) {
    const sents = splitSentences(p.text).map(s => s.trim()).filter(Boolean);
    sentenceCount += sents.length;
    const counts = sents.map(s => words(s).length);
    longSentences += counts.filter(n => n > 28).length;
    let run = 1, shortRun = counts[0] !== undefined && counts[0] <= 6 ? 1 : 0;
    for (let i = 1; i <= sents.length; i++) {
      const same = i < sents.length && (words(sents[i])[0] ?? "").toLowerCase() === (words(sents[i - 1])[0] ?? "").toLowerCase() && !!words(sents[i])[0];
      if (same) run++; else { if (run >= 3) repeatedOpeners++; run = 1; }
      if (i < sents.length && counts[i] <= 6) shortRun++; else { if (shortRun >= 4) shortRuns++; shortRun = 0; }
    }
  }
  const lower = text.toLowerCase();
  let repeatedTransitions = 0;
  for (const phrase of TRANSITIONS) {
    const hits = lower.match(new RegExp(`(?:^|[.!?]\\s+)${phrase}\\b`, "g")) ?? [];
    if (hits.length > 1) repeatedTransitions += hits.length - 1;
  }
  const stockPhrases = STOCK_PHRASES.reduce((n, p) => n + (lower.split(p.replace("'", "’")).length - 1) + (lower.split(p).length - 1), 0);
  const syllables = allWords.reduce((n, w) => n + countSyllables(w), 0);
  const wps = sentenceCount ? allWords.length / sentenceCount : 0;
  const spw = allWords.length ? syllables / allWords.length : 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    sentences: sentenceCount,
    words: allWords.length,
    avgWordsPerSentence: round(wps),
    longSentences,
    repeatedTransitions,
    passiveLike: (text.match(PASSIVE) ?? []).length,
    paragraphCount: paragraphs.length,
    readingEase: sentenceCount ? round(206.835 - 1.015 * wps - 84.6 * spw) : 0,
    gradeLevel: sentenceCount ? round(0.39 * wps + 11.8 * spw - 15.59) : 0,
    repeatedOpeners,
    stockPhrases,
    shortRuns
  };
}
