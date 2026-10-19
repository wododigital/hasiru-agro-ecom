// @ecomkit/search: public entry (pure parts only). Prefer the specific exports: manifest, domain, server, ui, admin, routes/*, messages.
export * from './domain';
export { searchMessages, type SearchMessages } from './messages';
export { searchSettingsSchema, type SearchSettings } from './settings';
