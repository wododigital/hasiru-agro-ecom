const ist = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** Admin timestamps are shown in IST. */
export const formatIst = (d: Date | null): string => (d ? ist.format(d) : '');

export const SOURCE_LABEL = { manual: 'Manual', erp: 'ERP', seed: 'Seed' } as const;
export const STATE_LABEL = { in_stock: 'In stock', preorder: 'Preorder', out_of_stock: 'Out of stock' } as const;
export const REASON_LABEL = { order: 'Order', cancel: 'Cancelled order', adjust: 'Adjustment', erp_sync: 'ERP sync', seed: 'Seed' } as const;
