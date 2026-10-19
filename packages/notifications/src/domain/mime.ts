// RFC 2822 / MIME for the Gmail API `raw` field: multipart/alternative (text + html), UTF-8, base64 parts.

export interface MailInput {
  from: string;
  fromName?: string;
  to: string;
  bcc?: string | null;
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  messageId?: string;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
/** RFC 2047 encoded word when the header has non-ASCII text. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const noCrLf = (s: string) => s.replace(/[\r\n]+/g, ' ');

/** Builds the message. Header values are stripped of CR/LF so a variable can never inject a header. */
export function buildMime(mail: MailInput): string {
  const boundary = `b_${(mail.messageId ?? Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9]/g, '')}`;
  const from = mail.fromName ? `${encodeHeader(noCrLf(mail.fromName))} <${noCrLf(mail.from)}>` : noCrLf(mail.from);
  const headers = [
    `From: ${from}`,
    `To: ${noCrLf(mail.to)}`,
    ...(mail.bcc ? [`Bcc: ${noCrLf(mail.bcc)}`] : []),
    ...(mail.replyTo ? [`Reply-To: ${noCrLf(mail.replyTo)}`] : []),
    `Subject: ${encodeHeader(noCrLf(mail.subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) => [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(body))].join('\r\n');
  const parts = [part('text/plain', mail.text), ...(mail.html ? [part('text/html', mail.html)] : [])];
  return [...headers, '', ...parts, `--${boundary}--`, ''].join('\r\n');
}

export const toBase64Url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
export const fromBase64Url = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export interface ParsedMail {
  headers: Record<string, string>;
  text: string | null;
  html: string | null;
}

const decodeHeader = (s: string) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, x: string) => Buffer.from(x, 'base64').toString('utf8'));

/** Parses what `buildMime` produces (the mock Gmail server and tests read sent mail with it). */
export function parseMime(raw: string): ParsedMail {
  const [head = '', ...rest] = raw.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = decodeHeader(line.slice(i + 1).trim());
  }
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'] ?? '')?.[1];
  const body = rest.join('\r\n\r\n');
  const out: ParsedMail = { headers, text: null, html: null };
  if (!boundary) return { ...out, text: body };
  for (const chunk of body.split(`--${boundary}`)) {
    const [ph = '', ...pb] = chunk.split('\r\n\r\n');
    const content = Buffer.from(pb.join('').replace(/\s+/g, ''), 'base64').toString('utf8');
    if (/text\/plain/i.test(ph)) out.text = content;
    else if (/text\/html/i.test(ph)) out.html = content;
  }
  return out;
}
