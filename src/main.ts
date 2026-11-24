import "./styles.css";
import { transformText } from "./engine/transform.ts";
import { RULE_IDS } from "./engine/rules.ts";
import type { Intensity, Knowledge, Shard, Standard } from "./engine/types.ts";
import { buildDocx, normalizeImported } from "./io.ts";
import { Packer } from "docx";
import mammoth from "mammoth";

const app = document.querySelector<HTMLDivElement>("#app")!;
const standards: { value: Standard; label: string }[] = [
  { value: "filipino-basic", label: "Basic Filipino English" },
  { value: "filipino-conversational", label: "Conversational Filipino English" },
  { value: "filipino-academic", label: "Academic Filipino English" },
  { value: "filipino-professional", label: "Professional Filipino English" },
  { value: "natural-global", label: "Natural Global English" }
];

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#"><span class="brand-mark">L</span><span>lexora</span></a>
    <span class="tagline">Language, naturally.</span>
    <span class="local-badge"><i></i> Local text processing</span>
  </header>
  <main class="shell">
    <section class="intro">
      <p class="eyebrow">NATURAL LANGUAGE TRANSFORMATION ENGINE</p>
      <h1>Make your writing<br><em>sound more natural.</em></h1>
      <p class="subhead">A rule-based writing assistant built around clear, natural English. No AI model. Your text is processed in your browser and is not stored.</p>
    </section>

    <section class="controls panel">
      <label>Writing standard
        <select id="standard">${standards.map(s => `<option value="${s.value}">${s.label}</option>`).join("")}</select>
      </label>
      <label>Editing strength
        <select id="intensity">
          <option value="light">Light — minimal changes</option>
          <option value="balanced" selected>Balanced — recommended</option>
          <option value="strong">Strong — more simplification</option>
        </select>
      </label>
      <label class="upload-label" for="fileInput"><span>＋</span> Import TXT / DOCX</label>
      <input id="fileInput" type="file" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden />
    </section>

    <section class="workspace">
      <div class="editor-card panel">
        <div class="card-head"><div><span class="step">01</span><strong>Original text</strong></div><span id="inputCount" class="muted">0 words</span></div>
        <textarea id="inputText" placeholder="Paste or import your writing here..."></textarea>
        <div class="card-foot"><span class="muted">Your text stays in this browser during editing.</span><button id="clearBtn" class="text-button">Clear</button></div>
      </div>
      <div class="editor-card panel output-card">
        <div class="card-head"><div><span class="step">02</span><strong>Naturalized text</strong></div><span id="outputCount" class="muted">0 words</span></div>
        <textarea id="outputText" placeholder="Your transformed text will appear here..." readonly></textarea>
        <div class="card-foot"><span id="changeCount" class="muted">Ready when you are</span><button id="copyBtn" class="text-button">Copy</button></div>
      </div>
    </section>

    <div class="action-row">
      <button id="transformBtn" class="primary-button"><span>✦</span> Humanize text</button>
      <div class="export-actions">
        <button id="txtBtn" class="secondary-button" disabled>Download TXT</button>
        <button id="docxBtn" class="secondary-button" disabled>Download DOCX</button>
      </div>
    </div>

    <section id="insights" class="insights panel" hidden>
      <div class="insight-title"><strong>Processing notes</strong><span class="muted">Review before using</span></div>
      <ul id="notesList"></ul>
      <div id="feedbackArea" class="feedback-area"></div>
    </section>

    <section class="privacy-note">
      <span class="shield">◇</span>
      <div><strong>Privacy by design</strong><p>Text transformation runs in your browser. Lexora does not send submitted text to its Worker or store it in D1. Only optional feedback on predefined rule IDs can update aggregate counters.</p></div>
    </section>
    <footer>LEXORA · EXPERIMENTAL RULE-BASED LANGUAGE TOOL · NOT AN AI DETECTOR</footer>
  </main>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $("inputText") as HTMLTextAreaElement;
const output = $("outputText") as HTMLTextAreaElement;
const standard = $("standard") as HTMLSelectElement;
const intensity = $("intensity") as HTMLSelectElement;
let lastPatternKeys: string[] = [];
// Optional curated knowledge (aggregate rule feedback + versioned shards). Stays undefined when D1 is
// unreachable; the engine then runs on its built-in rules. The engine validates everything it receives.
let knowledge: Knowledge | undefined;

async function refreshKnowledge() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch("/api/knowledge", { signal: controller.signal });
    if (!response.ok) return;
    const data = await response.json() as {
      patterns?: Array<{ pattern_key: string; positive_count: number; negative_count: number }>;
      shards?: Shard[];
      degraded?: boolean;
    };
    if (data.degraded && !(data.patterns?.length || data.shards?.length)) return;
    const scores: NonNullable<Knowledge["scores"]> = {};
    for (const row of data.patterns ?? []) {
      scores[row.pattern_key] = { positive: Number(row.positive_count) || 0, negative: Number(row.negative_count) || 0 };
    }
    knowledge = { scores, shards: Array.isArray(data.shards) ? data.shards : [] };
  } catch {
    // The engine remains fully usable when the optional knowledge store is offline.
  } finally {
    clearTimeout(timer);
  }
}

function wordCount(value: string) {
  return (value.trim().match(/\b[\p{L}\p{N}'’-]+\b/gu) ?? []).length;
}
function updateCounts() {
  $("inputCount").textContent = `${wordCount(input.value)} words`;
  $("outputCount").textContent = `${wordCount(output.value)} words`;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename() {
  return `lexora-${new Date().toISOString().slice(0, 10)}`;
}
function setExports(enabled: boolean) {
  $("txtBtn").toggleAttribute("disabled", !enabled);
  $("docxBtn").toggleAttribute("disabled", !enabled);
}

input.addEventListener("input", updateCounts);
$("clearBtn").addEventListener("click", () => {
  input.value = ""; output.value = ""; lastPatternKeys = [];
  $("insights").setAttribute("hidden", "");
  setExports(false); updateCounts();
});
$("transformBtn").addEventListener("click", () => {
  if (!input.value.trim()) { input.focus(); return; }
  if (input.value.length > 30000) {
    alert("For this experimental version, please keep each text under 30,000 characters.");
    return;
  }
  const result = transformText(input.value, standard.value as Standard, intensity.value as Intensity, knowledge);
  output.value = result.text;
  lastPatternKeys = result.patternKeys.filter(key => RULE_IDS.has(key)); // shard ids are never sent back
  $("changeCount").textContent = `${result.changes} transformation(s)`;
  const notes = $("notesList");
  notes.replaceChildren(...result.notes.map(note => {
    const li = document.createElement("li"); li.textContent = note; return li;
  }));
  const feedback = $("feedbackArea");
  feedback.replaceChildren();
  if (lastPatternKeys.length) {
    const label = document.createElement("span"); label.textContent = "Were these rule-based edits useful?";
    const yes = document.createElement("button"); yes.className = "feedback-button"; yes.textContent = "Helpful";
    const no = document.createElement("button"); no.className = "feedback-button"; no.textContent = "Not helpful";
    yes.addEventListener("click", () => sendFeedback(true));
    no.addEventListener("click", () => sendFeedback(false));
    feedback.append(label, yes, no);
  }
  $("insights").removeAttribute("hidden");
  setExports(true); updateCounts();
});
$("copyBtn").addEventListener("click", async () => {
  if (!output.value) return;
  try { await navigator.clipboard.writeText(output.value); $("copyBtn").textContent = "Copied"; }
  catch { output.select(); document.execCommand("copy"); }
  setTimeout(() => $("copyBtn").textContent = "Copy", 1200);
});
$("txtBtn").addEventListener("click", () => {
  if (output.value) downloadBlob(new Blob([output.value], { type: "text/plain;charset=utf-8" }), `${safeFilename()}.txt`);
});
$("docxBtn").addEventListener("click", async () => {
  if (!output.value) return;
  const blob = await Packer.toBlob(buildDocx(output.value));
  downloadBlob(blob, `${safeFilename()}.docx`);
});

async function sendFeedback(helpful: boolean) {
  // Only rule identifiers and a binary choice are transmitted; never the user's text.
  const results = await Promise.allSettled(lastPatternKeys.map(patternKey =>
    fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patternKey, helpful })
    })
  ));
  const area = $("feedbackArea");
  const message = document.createElement("small");
  message.textContent = results.some(r => r.status === "fulfilled" && r.value.ok)
    ? "Thanks. Aggregate rule feedback updated."
    : "Feedback could not be saved. Your text was not sent.";
  area.append(message);
  await refreshKnowledge();
}

$("fileInput").addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 1_000_000) { alert("Please choose a file smaller than 1 MB."); return; }
  try {
    if (file.name.toLowerCase().endsWith(".txt")) input.value = normalizeImported(await file.text());
    else if (file.name.toLowerCase().endsWith(".docx")) {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      input.value = normalizeImported(result.value);
    } else alert("Only TXT and DOCX files are supported.");
    output.value = ""; setExports(false); updateCounts();
  } catch { alert("This file could not be read. It may be damaged or unsupported."); }
  (event.target as HTMLInputElement).value = "";
});

// The app deliberately never posts text to the backend: the only requests are the knowledge GET and
// feedback POSTs that carry a predefined rule id plus a boolean.
void refreshKnowledge();
