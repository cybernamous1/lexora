import { Document, Paragraph, TextRun } from "docx";

/** Normalise text read from a TXT/DOCX file: strip BOM, unify line endings and non-breaking spaces. */
export function normalizeImported(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

/** Blank lines separate DOCX paragraphs; single line breaks inside a paragraph become real line breaks. */
export function buildDocx(text: string): Document {
  const paragraphs = text.split(/\n[ \t]*\n+/).filter(p => p.trim()).map(p =>
    new Paragraph({
      children: p.replace(/\s+$/, "").split("\n").map((line, i) => new TextRun({ text: line.trimEnd(), break: i ? 1 : undefined }))
    })
  );
  return new Document({ sections: [{ properties: {}, children: paragraphs }] });
}
