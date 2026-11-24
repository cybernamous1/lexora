// TXT / DOCX helpers. Needs the `docx` package (installed by npm install) and the `unzip` CLI for inspection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Packer } from "docx";
import { buildDocx, normalizeImported } from "../src/io.ts";
import { transformText } from "../src/engine/transform.ts";

const hasUnzip = (() => { try { execFileSync("unzip", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("normalizeImported strips BOM, CRLF and non-breaking spaces", () => {
  assert.equal(normalizeImported("\uFEFFA\r\nB\rC\u00a0D"), "A\nB\nC D");
});

test("DOCX export: valid package, paragraphs and line breaks preserved", { skip: !hasUnzip }, async () => {
  const text = "Heading line\n\nFirst paragraph, with “curly” quotes & <angle> brackets.\nSecond line in same paragraph.\n\n\nLast paragraph — ñandú.";
  const buf = await Packer.toBuffer(buildDocx(text));
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const dir = mkdtempSync(join(tmpdir(), "lexora-"));
  const file = join(dir, "out.docx");
  writeFileSync(file, buf);
  const xml = execFileSync("unzip", ["-p", file, "word/document.xml"]).toString();
  assert.equal((xml.match(/<w:p[ >]/g) ?? []).length, 3);
  assert.equal((xml.match(/<w:br\/>/g) ?? []).length, 1);
  assert.ok(xml.includes("&amp;") && xml.includes("&lt;angle&gt;") && xml.includes("ñandú"));
  assert.equal(execFileSync("unzip", ["-t", file]).toString().includes("No errors detected"), true);
});

test("TXT/DOCX round trip keeps paragraph structure through the engine", async () => {
  const imported = normalizeImported("\uFEFFTitle\r\n\r\nWe utilize tools in order to win.\r\n\r\nFurthermore, it works.");
  const out = transformText(imported, "natural-global", "balanced").text;
  assert.equal(out, "Title\n\nWe use tools to win.\n\nAlso, it works.");
  assert.equal(out.split(/\n[ \t]*\n+/).length, 3);
});
