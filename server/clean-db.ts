import { getDb, createBackupSnapshot, DEFAULT_DB_PATH } from './db.js';
import { cleanSlateDatabase, DEMO_ACCOUNTS } from './seed.js';

try {
  const db = getDb();

  // 1. Safety backup automatico prima dell'azzeramento
  console.log(`[Clean] Creazione backup di sicurezza automatico pre-azzeramento...`);
  const safetyBackup = createBackupSnapshot(db, { tag: 'prereset_clean' });
  console.log(`[Clean] Backup salvato in: ${safetyBackup.filepath}`);

  // 2. Azzeramento e inizializzazione Clean Slate
  const result = cleanSlateDatabase(db, {
    adminEmail: process.env.ADMIN_EMAIL || DEMO_ACCOUNTS.admin.email,
    adminPassword: process.env.ADMIN_PASSWORD || DEMO_ACCOUNTS.admin.password,
    adminFullName: process.env.ADMIN_NAME || DEMO_ACCOUNTS.admin.full_name,
    adminPhone: process.env.ADMIN_PHONE || DEMO_ACCOUNTS.admin.phone,
    studioName: process.env.STUDIO_NAME || 'Atelier Élan',
  });

  console.log(`\n============================================================`);
  console.log(`[Clean] Database SQLite azzerato con successo (Clean Slate)!`);
  console.log(`  File DB:       ${DEFAULT_DB_PATH}`);
  console.log(`  Allievi/Corsi: 0 (Database pulito per inizio lezioni reali)`);
  console.log(`  Account Admin: ${result.adminUser.email}`);
  console.log(`  Password:      ${result.adminUser.password}`);
  console.log(`  Sale pronte:   Sala 1 (Reformer) e Sala 2 (Matwork)`);
  console.log(`============================================================\n`);
} catch (err) {
  console.error('[Clean] Errore durante l\'azzeramento del database:', err);
  process.exit(1);
}
