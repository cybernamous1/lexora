import { test } from "node:test";
import assert from "node:assert/strict";
import { transformText } from "../src/engine/transform.ts";
import { analyzeText } from "../src/engine/analyzer.ts";
import { splitSentences } from "../src/engine/sentences.ts";
import { feedbackAdjust, prepareKnowledge, validateLexicon } from "../src/engine/knowledge.ts";
import { RULES, RULE_IDS } from "../src/engine/rules.ts";
import type { Intensity, Standard } from "../src/engine/types.ts";

const STANDARDS: Standard[] = ["filipino-basic", "filipino-conversational", "filipino-academic", "filipino-professional", "natural-global"];
const INTENSITIES: Intensity[] = ["light", "balanced", "strong"];
const run = (t: string, s: Standard = "natural-global", i: Intensity = "strong") => transformText(t, s, i).text;

test("rule table is well-formed", () => {
  assert.ok(RULES.length >= 80);
  assert.equal(new Set(RULES.map(r => r.id)).size, RULES.length);
  for (const id of RULES.map(r => r.id)) assert.match(id, /^[a-z0-9-]{3,80}$/);
  // v1.0.0 ids that the D1 feedback table may already contain must still exist.
  for (const id of ["phrase-it-is-important-to-note", "phrase-in-order-to", "phrase-due-to-the-fact", "transition-furthermore", "transition-moreover", "phrase-in-conclusion", "phrase-a-wide-range-of", "phrase-utilize", "phrase-approximately", "phrase-in-the-event-that", "phrase-for-the-purpose-of", "phrase-with-regard-to", "phrase-very-important"]) assert.ok(RULE_IDS.has(id), id);
});

test("regressions: bugs present in v1.0.0 are fixed", () => {
  assert.equal(run("We met for the purpose of testing it."), "We met for testing it.");           // was "to testing"
  assert.equal(run("This is a matter of great importance."), "This is a matter of great importance."); // was "of very important"
  assert.equal(run("It costs 1,000 pesos at 10:30."), "It costs 1,000 pesos at 10:30.");           // was "1, 000"
  assert.equal(run("She earned a Ph.D. in 2020."), "She earned a Ph.D. in 2020.");                  // was "Ph. D"
  assert.equal(run("It works; furthermore, it is cheap."), "It works; also, it is cheap.");         // was "; Also,"
  assert.equal(run("A wide range of knowledge helps."), "A wide range of knowledge helps.");        // was "many knowledge"
});

test("Philippine English usage fixes without forcing Taglish or errors", () => {
  assert.equal(run("We discussed about the budget."), "We discussed the budget.");
  assert.equal(run("I am looking forward to hear from you."), "I am looking forward to hearing from you.");
  assert.equal(run("Please revert back to me.", "filipino-professional"), "Please reply to me.");
  assert.equal(run("They need to cope up with the change."), "They need to cope with the change.");
  assert.equal(run("Kindly send the informations."), "Kindly send the information.");
  assert.equal(run("Where is the comfort room, po?"), "Where is the comfort room, po?"); // legitimate PH English untouched
  assert.equal(run("We will attend to the meeting."), "We will attend the meeting.");
});

test("grammar: articles, agreement, duplicates, typos", () => {
  assert.equal(run("A hour ago an university opened an Filipino shop."), "An hour ago a university opened a Filipino shop.");
  assert.equal(run("There is many reasons."), "There are many reasons.");
  assert.equal(run("They was late and he should of called."), "They were late and he should have called.");
  assert.equal(run("This is the the end."), "This is the end.");
  assert.equal(run("That that works. I had had enough."), "That that works. I had had enough.");
  assert.equal(run("It is better then nothing."), "It is better than nothing.");
  assert.equal(run("He bought an FAQ book and a NASA cap."), "He bought an FAQ book and a NASA cap."); // acronyms are not guessed
});

test("context guards prevent wrong substitutions", () => {
  assert.equal(run("He is able to swim but is not able to dive."), "He can swim but is not able to dive.");
  assert.equal(run("We need a purchase order and financial assistance."), "We need a purchase order and financial assistance.");
  assert.equal(run("The leverage of the lever."), "The leverage of the lever.");
  assert.equal(run("Approximately equal sides."), "Approximately equal sides.");
  assert.equal(run("About 50 people came, approximately 50 stayed."), "About 50 people came, about 50 stayed.");
  assert.equal(run("The requirements are clear."), "The requirements are clear.");
});

test("protected spans, headings and lists are preserved", () => {
  const q = 'He said, "We should utilize the tools in order to win." Then he left.';
  assert.equal(run(q), q);
  assert.equal(run("See https://example.com/in-order-to,utilize for details, in order to learn."), "See https://example.com/in-order-to,utilize for details, to learn.");
  const doc = "Introduction\n\n1. First item to utilize\n2. Second item, in order to test\n\nIn Conclusion\n\nIn conclusion, it works.";
  assert.equal(run(doc), "Introduction\n\n1. First item to use\n2. Second item, to test\n\nIn Conclusion\n\nTo sum up, it works.");
  assert.equal(run("Line one\r\nLine two utilizes it.").includes("\r"), false);
});

test("transitions rotate and never stack", () => {
  const r = run("Furthermore, the plan works. Moreover, the cost is low. Furthermore, the team agrees.");
  // Two alternatives exist for this standard, so the third connector is deliberately left alone
  // rather than repeating one of the last two choices.
  assert.equal(r, "Also, the plan works. In addition, the cost is low. Furthermore, the team agrees.");
  const openers = r.split(/(?<=\.)\s+/).map(s => s.split(",")[0]);
  assert.equal(new Set(openers).size, openers.length);
  assert.equal(run("Furthermore, it is important to note that the plan works."), "Also, the plan works.");
});

test("all five standards behave distinctly and sensibly", () => {
  const t = "Furthermore, we do not utilize approximately 50 tools. I am sure they will not come.";
  const out = Object.fromEntries(STANDARDS.map(s => [s, run(t, s, "balanced")]));
  assert.match(out["filipino-conversational"], /don't|won't|I'm/);
  assert.match(out["filipino-academic"], /^(In addition|Additionally),/);
  assert.match(out["filipino-academic"], /approximately 50/);           // academic keeps the formal word
  assert.doesNotMatch(out["filipino-academic"], /n't|'m/);                  // academic never contracts
  assert.match(run("They won't come and I'm sure.", "filipino-academic", "balanced"), /will not come and I am sure/);
  assert.match(out["filipino-basic"], /^Also,/);
  assert.match(out["filipino-professional"], /^(In addition|Also),/);
  for (const s of STANDARDS) assert.match(out[s], /50 tools/);
  assert.ok(new Set(Object.values(out)).size >= 3);
  // American spelling is a Filipino-English convention; natural-global leaves spelling alone.
  assert.equal(run("The colour centre.", "filipino-basic", "light"), "The color center.");
  assert.equal(run("The colour centre.", "natural-global", "light"), "The colour centre.");
  assert.equal(run("Makati Centre and the Labour Party.", "filipino-basic", "light"), "Makati Centre and the Labour Party.");
});

test("intensity levels are monotonic and light is conservative", () => {
  const t = "In order to finish, we utilize a wide range of tools. The majority of users obtain approximately 10 results.";
  const counts = INTENSITIES.map(i => transformText(t, "filipino-basic", i).changes);
  assert.ok(counts[0] <= counts[1] && counts[1] <= counts[2], counts.join());
  assert.equal(run(t, "filipino-basic", "light"), "To finish, we utilize a wide range of tools. The majority of users obtain approximately 10 results.");
  assert.match(run(t, "filipino-basic", "strong"), /many tools/);
  const long = "The project was very large and complex, and the team worked hard to deliver every part of it on time, but the client asked for many changes late in the process, so the schedule slipped by several weeks.";
  assert.equal(run(long, "filipino-conversational", "light"), long);                  // no restructuring at light
  assert.equal(splitSentences(run(long, "filipino-conversational", "strong")).length, 3);
  assert.match(run(long, "filipino-academic", "strong"), /However, the client[\s\S]*As a result, the schedule/);
  assert.equal(run(long, "filipino-academic", "balanced"), long);                     // under the academic threshold
});

test("meaning is preserved: numbers, negation, modals, names, quantifiers", () => {
  const samples = [
    "It is important to note that the Philippines may not reach 7.5 percent growth in 2027, according to the Department of Finance.",
    "We cannot approve all 1,250 applications, but we will review every case by March 3.",
    "Dr. Cruz will not utilize the machine unless Atty. Reyes approves; only 3 staff can operate it.",
    "Due to the fact that no one came, the event, which began at 10:30 a.m., was cancelled.",
    "Never leave the lab without a supervisor, and always report incidents to Engr. Santos in order to stay safe."
  ];
  const num = (s: string) => (s.match(/\d[\d,.]*\d|\d/g) ?? []).join("|");
  const neg = (s: string) => (s.toLowerCase().replace(/n't|cannot/g, " not").match(/\b(?:not|no|never|none|nor)\b/g) ?? []).length;
  for (const s of STANDARDS) for (const i of INTENSITIES) for (const t of samples) {
    const o = run(t, s, i);
    assert.equal(num(o), num(t), `${s}/${i}: ${o}`);
    assert.equal(neg(o), neg(t), `${s}/${i}: ${o}`);
    for (const name of ["Philippines", "Department of Finance", "Cruz", "Reyes", "Santos", "March"]) if (t.includes(name)) assert.ok(o.includes(name), `${s}/${i}: ${o}`);
    for (const m of ["may", "will", "can", "only", "all", "every", "always", "never"]) {
      const c = (x: string) => (x.toLowerCase().replace(/won't/g, "will not").replace(/'ll\b/g, " will").replace(/can't/g, "can not").match(new RegExp(`\\b${m}\\b`, "g")) ?? []).length;
      assert.ok(c(o) >= c(t), `${m} lost in ${s}/${i}: ${o}`);
    }
  }
});

test("robustness: odd input never throws or leaks internal markers", () => {
  const weird = ["", "   ", "...", "!!!???", "😀 utilize 😀", "a", "I", "\n\n\n", "x".repeat(5000), "\t\tutilize\tthis\t", "“Unclosed quote and utilize it", "(unbalanced parenthesis utilize it", "Ünïcödé utilize wörds.", "e.g. utilize it. i.e. use it."];
  for (const s of STANDARDS) for (const i of INTENSITIES) for (const t of weird) {
    const o = run(t, s, i);
    assert.equal(typeof o, "string");
    assert.doesNotMatch(o, /[\uE000\uE001]/);
  }
  assert.equal(run(""), "");
  assert.equal(run("Line A\n\n\nLine B utilize"), "Line A\n\n\nLine B use");
});

test("output is stable when run twice (idempotent on already-clean text)", () => {
  const t = "Furthermore, we utilize many tools in order to finish. We do not know.";
  for (const s of STANDARDS) {
    const once = run(t, s, "balanced");
    assert.equal(run(once, s, "balanced"), once, s);
  }
});

test("analyzer: readability and structure metrics", () => {
  const a = analyzeText("Dr. Cruz lives in Manila. He works hard. He works hard. He works hard.\n\nA new paragraph begins here.");
  assert.equal(a.paragraphCount, 2);
  assert.equal(a.sentences, 5);
  assert.equal(a.repeatedOpeners, 1);
  assert.ok(a.readingEase > 60);
  const b = analyzeText("The implementation of comprehensive organizational methodologies necessitates considerable administrative deliberation.");
  assert.ok(b.readingEase < 20 && b.gradeLevel > 15);
  assert.equal(splitSentences("Mr. Reyes met J. Rizal at 5 p.m. on Jan. 5. Then they left.").length, 2);
});

test("performance: 30,000 characters well under a second or two", () => {
  const para = "Furthermore, it is important to note that the team will utilize a wide range of tools in order to finish the project, and the manager approved every request; however, the budget was not enough. ";
  const text = para.repeat(Math.floor(30000 / para.length));
  const t0 = performance.now();
  const r = transformText(text, "filipino-professional", "strong");
  const ms = performance.now() - t0;
  assert.ok(r.changes > 50);
  assert.ok(ms < 2500, `took ${ms}ms`);
});

// ---------------- adaptive knowledge ----------------
test("feedback needs enough votes and is bounded", () => {
  assert.deepEqual(feedbackAdjust({ positive: 0, negative: 5 }), { adj: 0, boost: false });
  assert.ok(feedbackAdjust({ positive: 0, negative: 200 }).adj >= -0.2);
  assert.ok(feedbackAdjust({ positive: 200, negative: 0 }).adj <= 0.2);
  assert.equal(feedbackAdjust({ positive: 100, negative: 0 }).boost, true);
  assert.equal(feedbackAdjust({ positive: 6, negative: 6 }).boost, false);
});

test("negative feedback can retire a borderline rule but cannot disable a core rule", () => {
  const bad = { scores: { "phrase-at-the-end-of-the-day": { positive: 0, negative: 60 }, "phrase-in-order-to": { positive: 0, negative: 5000 } } };
  const t = "At the end of the day, we left in order to rest.";
  assert.equal(run(t), "In the end, we left to rest.");
  assert.equal(transformText(t, "natural-global", "strong", bad).text, "At the end of the day, we left to rest.");
  assert.equal(transformText(t, "natural-global", "strong", { scores: { "phrase-at-the-end-of-the-day": { positive: 0, negative: 3 } } }).text, "In the end, we left to rest.");
  assert.equal(transformText(t, "natural-global", "strong", { scores: { "made-up-id": { positive: 0, negative: 99 } } }).text, "In the end, we left to rest.");
});

test("lexicon shards: used only after validation; versions and confidence respected", () => {
  const shard = (o: object) => ({ id: "extra", version: 1, kind: "lexicon" as const, confidence: 0.8, payload: { pairs: [{ from: "in the midst of", to: "during" }] }, ...o });
  const t = "It happened in the midst of the storm.";
  const go = (shards: object[]) => transformText(t, "natural-global", "balanced", { shards: shards as never }).text;
  assert.equal(go([]), t);
  assert.equal(go([shard({})]), "It happened during the storm.");
  assert.equal(go([shard({ confidence: 0.5 })]), t);                       // too uncertain
  assert.equal(go([shard({ engineMin: 99 })]), t);                         // needs a newer engine
  assert.equal(go([shard({ version: 2, payload: { pairs: [{ from: "in the midst of", to: "amid" }] } }), shard({})]), "It happened amid the storm."); // newest version wins
  assert.equal(go([shard({ id: "BAD ID!" })]), t);
  assert.equal(go([shard({ kind: "other" })]), t);
  assert.equal(go([shard({ standards: ["filipino-academic"] })]), t);       // scoped to other standards
});

test("shard validation rejects meaning-changing or malformed pairs", () => {
  const v = (from: string, to: string) => validateLexicon({ pairs: [{ from, to }, { from: "in the midst of", to: "during" }] })!.pairs.length === 2;
  assert.equal(v("is not", "is"), false);               // drops a negation
  assert.equal(v("will", "might"), false);              // changes a modal
  assert.equal(v("all of the", "the"), false);          // drops a quantifier
  assert.equal(v("a b c", "x y z q r"), false);         // grows too much
  assert.equal(v("price is 5", "cost"), false);         // digits
  assert.equal(v("before", "<script>"), false);         // markup
  assert.equal(v("in addition to", "besides"), true);
  assert.equal(validateLexicon({ pairs: [] }), null);
  assert.equal(validateLexicon({ pairs: Array.from({ length: 201 }, () => ({ from: "aa", to: "bb" })) }), null);
  assert.equal(validateLexicon("x"), null);
});

test("tuning shards are clamped and limited to known rules", () => {
  const ks = prepareKnowledge({ shards: [{ id: "tune", version: 1, kind: "tuning", confidence: 0.9, payload: { rules: { "phrase-utilize": -5, "nope": 1 } } }] });
  assert.equal(ks.tuning.get("phrase-utilize"), -0.3);
  assert.equal(ks.tuning.has("nope"), false);
  const tune = (rule: string) => ({ shards: [{ id: "tune", version: 1, kind: "tuning" as const, confidence: 0.9, payload: { rules: { [rule]: -0.3 } } }] });
  assert.equal(transformText("A wide range of tools.", "natural-global", "strong", tune("phrase-a-wide-range-of")).text, "A wide range of tools."); // 0.80-0.30 falls below the threshold
  assert.equal(transformText("We utilize it.", "natural-global", "balanced", tune("phrase-utilize")).text, "We use it.");               // a high-confidence rule survives
});

test("engine works with no knowledge at all (D1 unavailable)", () => {
  const r = transformText("We utilize tools.", "natural-global", "balanced");
  assert.equal(r.text, "We use tools.");
  assert.ok(r.notes.some(n => /Built-in rules only/.test(n)));
  assert.deepEqual(r.patternKeys, ["phrase-utilize"]);
  assert.equal(transformText("We utilize tools.", "natural-global", "balanced", {}).text, "We use tools.");
});
