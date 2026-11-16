import { getDb, DEFAULT_DB_PATH } from './db.js';
import { seedDatabase, DEMO_ACCOUNTS } from './seed.js';

const db = getDb();
seedDatabase(db, { force: true });

console.log(`Database locale rigenerato con successo in: ${DEFAULT_DB_PATH}`);
console.log('Account demo pronti:');
console.log(`  Titolare (ADMIN):    ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password}`);
console.log(`  Insegnante 1 (STAFF): ${DEMO_ACCOUNTS.teacher1.email} / ${DEMO_ACCOUNTS.teacher1.password}`);
console.log(`  Insegnante 2 (STAFF): ${DEMO_ACCOUNTS.teacher2.email} / ${DEMO_ACCOUNTS.teacher2.password}`);
