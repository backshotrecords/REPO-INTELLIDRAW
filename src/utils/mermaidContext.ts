export const EXTERNAL_CONTEXT_HEADER = "%% EXTERNAL CONTEXT:";
export const EXTERNAL_CONTEXT_FOOTER = "%% END EXTERNAL CONTEXT";

const EXTERNAL_CONTEXT_HEADER_RE = /^%%\s*EXTERNAL CONTEXT:\s*$/i;
const EXTERNAL_CONTEXT_FOOTER_RE = /^%%\s*END EXTERNAL CONTEXT\s*$/i;
const OBJECTIVES_RE = /^%%\s*OBJECTIVES:/i;
const COMMENT_RE = /^%%\s?/;

type LineRange = {
  start: number;
  end: number;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function findExternalContextRange(lines: string[]): LineRange | null {
  const start = lines.findIndex((line) => EXTERNAL_CONTEXT_HEADER_RE.test(line.trimEnd()));
  if (start === -1) return null;

  const footer = lines.findIndex((line, index) =>
    index > start && EXTERNAL_CONTEXT_FOOTER_RE.test(line.trimEnd())
  );
  if (footer !== -1) return { start, end: footer };

  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (OBJECTIVES_RE.test(line.trimEnd()) || !line.trimStart().startsWith("%%")) break;
    end = index;
  }

  return { start, end };
}

function findExternalContextInsertIndex(lines: string[]): number {
  const objectivesIndex = lines.findIndex((line) => OBJECTIVES_RE.test(line.trimEnd()));
  if (objectivesIndex !== -1) return objectivesIndex;

  const firstContentIndex = lines.findIndex((line) => line.trim() !== "");
  return firstContentIndex === -1 ? 0 : firstContentIndex;
}

export function formatMermaidExternalContextBlock(externalContext: string): string[] {
  const bodyLines = normalizeLineEndings(externalContext)
    .trim()
    .split("\n")
    .map((line) => (line.trim() ? `%% ${line}` : "%%"));

  return [EXTERNAL_CONTEXT_HEADER, ...bodyLines, EXTERNAL_CONTEXT_FOOTER];
}

export function extractMermaidExternalContext(mermaidCode: string): string | null {
  const lines = normalizeLineEndings(mermaidCode).split("\n");
  const range = findExternalContextRange(lines);
  if (!range) return null;

  const body = lines
    .slice(range.start + 1, range.end + 1)
    .filter((line) => !EXTERNAL_CONTEXT_FOOTER_RE.test(line.trimEnd()))
    .map((line) => line.replace(COMMENT_RE, ""))
    .join("\n")
    .trim();

  return body || null;
}

export function setMermaidExternalContext(mermaidCode: string, externalContext: string): string {
  const hadTrailingNewline = /\r?\n$/.test(mermaidCode);
  const lines = normalizeLineEndings(mermaidCode).split("\n");
  const existingRange = findExternalContextRange(lines);

  if (existingRange) {
    lines.splice(existingRange.start, existingRange.end - existingRange.start + 1);
  }

  while (lines.length > 0 && lines[0].trim() === "") lines.shift();

  const trimmedContext = externalContext.trim();
  if (trimmedContext) {
    const insertIndex = findExternalContextInsertIndex(lines);
    lines.splice(insertIndex, 0, ...formatMermaidExternalContextBlock(trimmedContext));
  }

  let nextCode = lines.join("\n");
  if (hadTrailingNewline && nextCode && !nextCode.endsWith("\n")) nextCode += "\n";
  return nextCode;
}

export function clearMermaidExternalContext(mermaidCode: string): string {
  return setMermaidExternalContext(mermaidCode, "");
}
