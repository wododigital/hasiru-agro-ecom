'use server';

import { ForbiddenError, NotFoundError } from '@ecomkit/core/auth-context';
import { addPackage, inputsFor, saveLandFromPlan, type PackageStatus } from '../server/plans';
import type { InputLine } from '../server/runtime';

/** "Add package to cart" (results page). Validation and the unlocked check live in `addPackage`. */
export async function addPackageAction(input: unknown): Promise<{ status: PackageStatus }> {
  return addPackage(input);
}

/** Recommended inputs for edited plant quantities. */
export async function inputsAction(input: unknown): Promise<InputLine[]> {
  try {
    return await inputsFor(input);
  } catch {
    return [];
  }
}

/** "Save this land" (signed-in customers). */
export async function saveLandAction(input: unknown): Promise<{ ok: boolean }> {
  try {
    return { ok: (await saveLandFromPlan(input)) !== null };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof NotFoundError || (err as Error).name === 'ZodError') return { ok: false };
    throw err;
  }
}
