import { getDb, createBackupSnapshot, DEFAULT_DB_PATH } from './db.js';

try {
  const db = getDb();
  console.log(`[Backup] Creazione snapshot SQLite atomico in corso da: ${DEFAULT_DB_PATH}...`);
  const backup = createBackupSnapshot(db, { tag: 'manual' });
  console.log(`[Backup] Completato con successo!`);
  console.log(`  File:        ${backup.filename}`);
  console.log(`  Percorso:    ${backup.filepath}`);
  console.log(`  Dimensione:  ${(backup.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`  Creato alle: ${backup.createdAt}`);
} catch (err) {
  console.error('[Backup] Errore durante la creazione del backup:', err);
  process.exit(1);
}
