import * as SQLite from 'expo-sqlite';
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
export function database() {
  if (!opening) opening = SQLite.openDatabaseAsync('done-yet.db').then(async db => {
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    return db;
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
export const repository = {
  async read() { return (await (await database()).getFirstAsync<{ snapshot: string }>('SELECT snapshot FROM app_state WHERE id=1'))?.snapshot ?? null; },
  async write(snapshot: string) {
    const db = await database();
    await db.withExclusiveTransactionAsync(async tx => {
      // Keep one previous committed snapshot for recovery; all writes are atomic.
      await tx.runAsync("INSERT OR REPLACE INTO app_metadata(key,value) SELECT 'previous_snapshot',snapshot FROM app_state WHERE id=1");
      await tx.runAsync('INSERT INTO app_state (id,snapshot) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot', snapshot);
    });
  },
};
export async function readMetadata(key: string) { return (await (await database()).getFirstAsync<{ value: string }>('SELECT value FROM app_metadata WHERE key=?', key))?.value ?? null; }
export async function writeMetadata(key: string, value: string) { await (await database()).runAsync('INSERT OR REPLACE INTO app_metadata(key,value) VALUES (?,?)', key, value); }
