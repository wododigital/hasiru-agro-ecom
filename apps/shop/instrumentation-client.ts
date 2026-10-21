import { z } from 'zod';

// Zod probes `new Function` once to choose its JIT object parser. The CSP has no 'unsafe-eval', so the browser reports
// that swallowed probe as a CSP violation on every page; client-side parsing is small, so skip the JIT (WP-37).
z.config({ jitless: true });
