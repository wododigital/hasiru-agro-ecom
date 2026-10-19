import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Drizzle over one `pg` Pool. Modules use the SQL-like builder (`db.select().from(table)`); no relational query schema is bound. */
export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
