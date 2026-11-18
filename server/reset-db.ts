import { getDb, createBackupSnapshot, DEFAULT_DB_PATH } from './db.js';
import { seedDatabase, DEMO_ACCOUNTS } from './seed.js';

const db = getDb();

try {
  const safetyBackup = createBackupSnapshot(db, { tag: 'prereset_demo' });
  console.log(`[Reset] Backup di sicurezza salvato in: ${safetyBackup.filepath}`);
} catch (err) {
  console.warn('[Reset] Avviso: impossibile creare backup automatico:', err);
}

seedDatabase(db, { force: true });

console.log(`\n============================================================`);
console.log(`[Reset] Database locale rigenerato con successo (Dataset DEMO): ${DEFAULT_DB_PATH}`);
console.log('Account demo pronti:');
console.log(`  Titolare (ADMIN):    ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password}`);
console.log(`  Insegnante 1 (STAFF): ${DEMO_ACCOUNTS.teacher1.email} / ${DEMO_ACCOUNTS.teacher1.password}`);
console.log(`  Insegnante 2 (STAFF): ${DEMO_ACCOUNTS.teacher2.email} / ${DEMO_ACCOUNTS.teacher2.password}`);
console.log(`============================================================\n`);
