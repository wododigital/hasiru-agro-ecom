// Minimal read-only XLSX reader: unzip (central directory + inflateRaw) and pull cell values out of the
// sheet XML. Enough for the client workbook (shared strings, numbers, inline strings, booleans).
// Limit: regex XML parsing, fine for machine-written OOXML; swap for the `xlsx` package once
// @tooling/scripts declares it (cross-package request in BUILD-STATUS/wp-14.md).
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export type Cell = string | number | boolean | null;
/** Sheet rows keyed by 1-based sheet row number; each row is a 0-based array of cells (A = 0). */
export type Sheet = Map<number, Cell[]>;

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx: not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/** Text of every <t> inside a fragment, skipping phonetic runs. */
const textOf = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readWorkbook(path: string): Map<string, Sheet> {
  const files = unzip(readFileSync(path));
  const text = (name: string) => files.get(name)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rels = new Map(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => {
      const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]!)?.[1] ?? '';
      return [attr('Id'), attr('Target').replace(/^\/?(xl\/)?/, 'xl/')] as const;
    }),
  );
  const sheets = new Map<string, Sheet>();
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? '');
    const rid = /\br:id="([^"]*)"/.exec(m[1]!)?.[1] ?? '';
    const xml = text(rels.get(rid) ?? '');
    const sheet: Sheet = new Map();
    for (const row of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: Cell[] = [];
      for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const body = c[2] ?? '';
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        if (!ref) continue;
        const type = /\bt="(\w+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: Cell = null;
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'str' && v !== undefined) value = decodeXml(v);
        else if (type === 'b' && v !== undefined) value = v === '1';
        else if (v !== undefined) value = Number(v);
        cells[colIndex(ref)] = value;
      }
      for (let i = 0; i < cells.length; i++) cells[i] ??= null;
      sheet.set(Number(row[1]), cells);
    }
    sheets.set(name, sheet);
  }
  return sheets;
}

/** Sheet lookup that ignores surrounding whitespace in the tab name ("Plant list " in the client file). */
export function sheetByName(book: Map<string, Sheet>, name: string): Sheet {
  for (const [k, v] of book) if (k.trim() === name) return v;
  throw new Error(`xlsx: sheet "${name}" not found (have: ${[...book.keys()].join(', ')})`);
}
