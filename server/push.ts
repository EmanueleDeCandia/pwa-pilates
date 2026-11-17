import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { ensureDataDir, getDb } from './db.js';
import { sendRealtimePushAlert } from './realtime.js';
import { getStudioNow } from './services.js';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedVapid: VapidKeys | null = null;

export function initVapidKeys(): VapidKeys {
  if (cachedVapid) return cachedVapid;

  const dataDir = ensureDataDir();
  const vapidPath = path.join(dataDir, 'vapid.json');

  if (fs.existsSync(vapidPath)) {
    try {
      cachedVapid = JSON.parse(fs.readFileSync(vapidPath, 'utf-8')) as VapidKeys;
    } catch {
      cachedVapid = null;
    }
  }

  if (!cachedVapid) {
    cachedVapid = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidPath, JSON.stringify(cachedVapid, null, 2), { mode: 0o600 });
  }

  webpush.setVapidDetails(
    'mailto:elena.rossi@atelierpilates.it',
    cachedVapid.publicKey,
    cachedVapid.privateKey
  );

  return cachedVapid;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  lessonSlotId?: string;
}

export async function dispatchTeacherNotification(
  userId: string,
  payload: PushPayload
): Promise<{ webPushSent: boolean; inAppSent: boolean; reason?: string }> {
  // Invia sempre alert real-time se l'app è aperta
  sendRealtimePushAlert(userId, `${payload.title} — ${payload.body}`, payload.lessonSlotId);

  const db = getDb();
  const row = db
    .prepare('SELECT push_subscription FROM users WHERE id = ?')
    .get(userId) as { push_subscription: string | null } | undefined;

  if (!row?.push_subscription) {
    return {
      webPushSent: false,
      inAppSent: true,
      reason: 'Nessuna sottoscrizione Web Push registrata sul dispositivo; inviato avviso in-app.',
    };
  }

  try {
    initVapidKeys();
    const subscription = JSON.parse(row.push_subscription) as webpush.PushSubscription;
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600 });
    return { webPushSent: true, inAppSent: true };
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      // Sottoscrizione scaduta o revocata dal browser
      db.prepare('UPDATE users SET push_subscription = NULL WHERE id = ?').run(userId);
    }
    return {
      webPushSent: false,
      inAppSent: true,
      reason: 'Sottoscrizione push non raggiungibile nell’ambiente locale; inviato avviso in-app.',
    };
  }
}

function formatTimeHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Cron-job server-side (SRS 4.3):
 * 1) 60 minuti prima di start_time -> Promemoria turno e sala assegnata
 * 2) 5 minuti dopo end_time (se is_validated = 0) -> Promemoria validazione appello
 */
export async function runReminderSchedulerTick(): Promise<void> {
  const db = getDb();
  const { nowMs } = getStudioNow();

  // 1. Lezioni in partenza tra 55 e 65 minuti
  const preFrom = new Date(nowMs + 55 * 60_000).toISOString();
  const preTo = new Date(nowMs + 65 * 60_000).toISOString();

  const upcomingSlots = db
    .prepare(
      `SELECT ls.id, ls.title, ls.start_time, ls.teacher_id, r.name AS room_name
       FROM lesson_slots ls
       JOIN rooms r ON r.id = ls.room_id
       LEFT JOIN sent_notifications sn ON sn.lesson_slot_id = ls.id AND sn.kind = 'PRE_60M'
       WHERE sn.lesson_slot_id IS NULL
         AND ls.start_time >= ? AND ls.start_time <= ?`
    )
    .all(preFrom, preTo) as {
    id: string;
    title: string;
    start_time: string;
    teacher_id: string;
    room_name: string;
  }[];

  for (const slot of upcomingSlots) {
    db.prepare(
      `INSERT OR IGNORE INTO sent_notifications (lesson_slot_id, kind) VALUES (?, 'PRE_60M')`
    ).run(slot.id);
    await dispatchTeacherNotification(slot.teacher_id, {
      title: `Tra 60 min: ${slot.title}`,
      body: `Ore ${formatTimeHHMM(slot.start_time)} presso ${slot.room_name}. Buon lavoro!`,
      tag: `pre60-${slot.id}`,
      url: `/?lesson=${slot.id}`,
      lessonSlotId: slot.id,
    });
  }

  // 2. Lezioni terminate da 5-25 minuti e non ancora validate
  const postFrom = new Date(nowMs - 25 * 60_000).toISOString();
  const postTo = new Date(nowMs - 5 * 60_000).toISOString();

  const unvalidatedSlots = db
    .prepare(
      `SELECT ls.id, ls.title, ls.end_time, ls.teacher_id, r.name AS room_name
       FROM lesson_slots ls
       JOIN rooms r ON r.id = ls.room_id
       LEFT JOIN sent_notifications sn ON sn.lesson_slot_id = ls.id AND (sn.kind = 'POST_5M' OR sn.kind = 'POST_15M')
       WHERE sn.lesson_slot_id IS NULL
         AND ls.is_validated = 0
         AND ls.end_time >= ? AND ls.end_time <= ?`
    )
    .all(postFrom, postTo) as {
    id: string;
    title: string;
    end_time: string;
    teacher_id: string;
    room_name: string;
  }[];

  for (const slot of unvalidatedSlots) {
    db.prepare(
      `INSERT OR IGNORE INTO sent_notifications (lesson_slot_id, kind) VALUES (?, 'POST_5M')`
    ).run(slot.id);
    await dispatchTeacherNotification(slot.teacher_id, {
      title: `Conferma Appello: ${slot.title}`,
      body: `La lezione in ${slot.room_name} è terminata da 5 min. Ricorda di chiudere l'appello.`,
      tag: `post5-${slot.id}`,
      url: `/?lesson=${slot.id}`,
      lessonSlotId: slot.id,
    });
  }
}

export function startReminderCronJob(): NodeJS.Timeout {
  const timer = setInterval(() => {
    runReminderSchedulerTick().catch(() => {
      // non interrompere il processo su errori transienti
    });
  }, 60_000);
  timer.unref();
  return timer;
}
