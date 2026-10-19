// Monitoring has no storefront copy: its screens are admin (English, exempt) and its endpoints return JSON.
// Alert message text is built in domain (alertText, digestText) and rendered by the notifications templates
// `alert.critical` and `alert.digest` from the vars monitoring passes: text, title, body, severity, count, status, url.
export const monitoringMessages = {} as const;
export type MonitoringMessages = typeof monitoringMessages;
