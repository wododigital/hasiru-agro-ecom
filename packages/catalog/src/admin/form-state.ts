import type { ImportReport } from '../server/import';

/** Result of an admin form action (useActionState). */
export type FormState = { ok: boolean; message: string; fieldErrors?: Record<string, string[]>; report?: ImportReport } | null;
