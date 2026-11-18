import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DB_PATH, BACKUPS_DIR, listBackups, ensureBackupsDir } from './db.js';

ensureBackupsDir();

const targetArg = process.argv[2];

if (!targetArg) {
  const backups = listBackups();
  console.log(`\nUtilizzo: npm run db:restore <nome_file_backup.sqlite>`);
  console.log(`\nBackup disponibili in ${BACKUPS_DIR}:`);
  if (backups.length === 0) {
    console.log(`  (Nessun backup trovato in ${BACKUPS_DIR})`);
  } else {
    backups.forEach((b, idx) => {
      console.log(`  [${idx + 1}] ${b.filename}  (${(b.sizeBytes / 1024).toFixed(1)} KB) - ${b.createdAt}`);
    });
  }
  process.exit(1);
}

const backupPath = path.isAbsolute(targetArg)
  ? targetArg
  : path.join(BACKUPS_DIR, path.basename(targetArg));

if (!fs.existsSync(backupPath)) {
  console.error(`[Restore] Errore: File di backup non trovato: ${backupPath}`);
  process.exit(1);
}

try {
  // Esegui checkpoint e chiusura per rilasciare i lock WAL
  try {
    const { DatabaseSync } = await import('node:sqlite');
    if (fs.existsSync(DEFAULT_DB_PATH)) {
      const activeDb = new DatabaseSync(DEFAULT_DB_PATH);
      activeDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      activeDb.close();
    }
  } catch {
    // ignore
  }

  // Rimuovi eventuali file WAL e SHM se non più bloccati
  const walPath = `${DEFAULT_DB_PATH}-wal`;
  const shmPath = `${DEFAULT_DB_PATH}-shm`;
  try {
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  } catch {
    // ignore se mantenuto dal processo
  }
  try {
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  } catch {
    // ignore se mantenuto dal processo
  }

  fs.copyFileSync(backupPath, DEFAULT_DB_PATH);

  console.log(`\n============================================================`);
  console.log(`[Restore] Database ripristinato con successo!`);
  console.log(`  Sorgente:     ${backupPath}`);
  console.log(`  Destinazione: ${DEFAULT_DB_PATH}`);
  console.log(`============================================================\n`);
} catch (err) {
  console.error('[Restore] Errore durante il ripristino del database:', err);
  process.exit(1);
}
