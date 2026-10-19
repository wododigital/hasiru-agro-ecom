import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach the merger the custom theme keys so `shadow-card` and `font-display` dedupe like built-ins.
const twMerge = extendTailwindMerge({ extend: { theme: { font: ['display', 'body'], shadow: ['card'] } } });

/** Merge class names; later Tailwind utilities win over earlier ones. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
