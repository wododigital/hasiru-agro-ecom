// Markdown-lite for answers: paragraphs, "- " bullets, **bold**, and [[productId]] tokens. No library, no HTML.

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'product'; id: string };
export type Block = { kind: 'p'; parts: Inline[] } | { kind: 'ul'; items: Inline[][] };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    out.push(m[1] != null ? { kind: 'bold', text: m[1] } : { kind: 'product', id: m[2]!.trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

/** Works on partial text too (the drawer re-parses as deltas arrive). */
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', parts: parseInline(para.join(' ')) });
    para = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = /^(?:[-*•])\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (bullet) {
      flush();
      const prev = blocks.at(-1);
      const item = parseInline(bullet[1]!);
      if (prev?.kind === 'ul') prev.items.push(item);
      else blocks.push({ kind: 'ul', items: [item] });
    } else para.push(line);
  }
  flush();
  return blocks;
}
