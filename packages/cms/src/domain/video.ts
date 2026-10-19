/** YouTube video id from any common URL shape (watch, youtu.be, shorts, embed), or null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Data for VideoObject JSON-LD; the page itself links out (no third-party iframe or image on the page). */
export function videoLinks(kind: 'youtube' | 'whatsapp' | 'file', url: string): { embedUrl: string | null; contentUrl: string | null; thumbnailUrl: string | null } {
  if (kind === 'youtube') {
    const id = youtubeId(url);
    return id
      ? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, contentUrl: null, thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }
      : { embedUrl: null, contentUrl: url, thumbnailUrl: null };
  }
  return { embedUrl: null, contentUrl: url, thumbnailUrl: null };
}
