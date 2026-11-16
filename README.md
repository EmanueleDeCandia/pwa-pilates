# Atelier Élan — PWA Gestionale per Studio di Pilates & Danza Sportiva

Applicazione **Full-Stack Progressive Web App (PWA)** progettata e sviluppata in lingua italiana in piena conformità alla **Specifica Tecnica dei Requisiti Software (SRS)** ([`PWA-gestionale-danza-sportiva-e-pilates.md`](./PWA-gestionale-danza-sportiva-e-pilates.md)).

Il sistema copre l'intera operatività quotidiana di uno studio di Pilates e Danza Sportiva con sale condivise: calendario multi-sala con prevenzione hard dei conflitti, gestione anagrafica e note mediche/posturali degli allievi, vendita e contabilità dei pacchetti lezioni, appello mobile-first in 2 tocchi per le insegnanti con isolamento rigoroso dei dati economici (**Row-Level Security**), notifiche **Web Push** e feed dinamico **Google Calendar (`.ics`)**, automazione comunicazioni **WhatsApp a costo zero (`wa.me`)**, bacheca pubblica corsi mirati **zero-login**, dashboard direzionale KPI, **Audit Log** completo, esportazione contabile **CSV/Excel** e **database relazionale locale SQLite** pronto per il collaudo di pre-produzione (affiancato dallo schema PostgreSQL/Supabase per il rilascio cloud).

---

## Indice

1. [Panoramica e Matrice di Tracciabilità SRS](#1-panoramica-e-matrice-di-tracciabilità-srs)
2. [Architettura e Stack Tecnologico](#2-architettura-e-stack-tecnologico)
3. [Struttura Completa del Repository](#3-struttura-completa-del-repository)
4. [Requisiti, Installazione e Comandi Operativi](#4-requisiti-installazione-e-comandi-operativi)
5. [Variabili d'Ambiente e File Runtime](#5-variabili-dambiente-e-file-runtime)
6. [Account Dimostrativi e Dataset di Pre-Produzione](#6-account-dimostrativi-e-dataset-di-pre-produzione)
7. [Ruoli, Autenticazione e Sicurezza RLS](#7-ruoli-autenticazione-e-sicurezza-rls)
8. [Schema del Database Locale, Indici, Trigger e Viste](#8-schema-del-database-locale-indici-trigger-e-viste)
9. [Regole di Business, Vincoli Hard e Macchina a Stati dei Crediti](#9-regole-di-business-vincoli-hard-e-macchina-a-stati-dei-crediti)
10. [Guida Dettagliata ai Moduli Funzionali](#10-guida-dettagliata-ai-moduli-funzionali)
11. [Alerting Multi-Canale, Real-Time WebSocket e PWA](#11-alerting-multi-canale-real-time-websocket-e-pwa)
12. [Riferimento Completo API REST e Codici di Errore](#12-riferimento-completo-api-rest-e-codici-di-errore)
13. [Esportazione Contabile e Backup dei Dati](#13-esportazione-contabile-e-backup-dei-dati)
14. [Suite di Test Automatici End-to-End](#14-suite-di-test-automatici-end-to-end)
15. [Passaggio in Produzione e Migrazione PostgreSQL/Supabase](#15-passaggio-in-produzione-e-migrazione-postgresqlsupabase)
16. [Risoluzione dei Problemi (Troubleshooting)](#16-risoluzione-dei-problemi-troubleshooting)

---

## 1. Panoramica e Matrice di Tracciabilità SRS

Ogni requisito del documento `PWA-gestionale-danza-sportiva-e-pilates.md` è implementato e verificato automaticamente:

| Sez. SRS | Requisito | Implementazione nel Progetto |
| --- | --- | --- |
| **1** | Ruolo **Titolare (`ADMIN`)** con accesso completo, contabilità, sale, audit e sblocco appelli | `server/auth.ts` (`requireAdmin`), `src/App.tsx`, `src/pages/admin/*.tsx` |
| **1** | Ruolo **Insegnante (`STAFF`)** con login Email+Password o **Magic Link**, vista sale/propri corsi e zero dati economici | `server/routes.ts` (`/api/auth/login`, `/api/auth/magic-*`), `src/pages/LoginPage.tsx`, `src/pages/staff/StaffPortal.tsx` |
| **1** | Ruolo **Studente (Zero-Login)** gestito dalla Titolare e informato via WhatsApp + bacheca pubblica | `src/pages/PublicBoardPage.tsx`, `src/pages/admin/AdminWhatsApp.tsx`, `src/components/WhatsAppActionModal.tsx` |
| **2.1–2.7** | Entità `users`, `rooms`, `students`, `packages`, `lesson_slots`, `bookings`, `audit_logs` + formato telefono E.164 | `server/db.ts`, `shared/types.ts`, `supabase/schema.sql` |
| **2.5** | Corsi ricorrenti salvati come singole istanze modificabili (collegate da `series_id`) | `server/routes.ts` (`POST /api/lessons` con `repeat_weeks` 1..24) |
| **3.1** | Vincoli hard: **Conflitto Sala**, **Conflitto Insegnante** e **Capienza Massima** con contatore live | Trigger SQL in `server/db.ts` + controlli transazionali `BEGIN IMMEDIATE` in `server/services.ts` |
| **3.2** | Scalabilità crediti post-lezione (`PENDING`, `PRESENT`, `ABSENT_PENDING_DECISION`, `ABSENT_DEDUCTED`, `ABSENT_FROZEN`, `RESCHEDULE_REQUESTED`) | `updateBookingAttendance()` e `rescheduleBookingToSlot()` in `server/services.ts` |
| **3.2** | Blocco appello alla validazione (`is_validated = true`) e **Sblocca Appello** esclusivo Titolare | `validateLessonRollCall()` e `unlockLessonRollCall()` in `server/services.ts`, `src/components/LessonDetailModal.tsx` |
| **3.3** | Solo **monte ore validato** insegnanti (nessun modulo compensi/paghe) | `GET /api/teachers`, `GET /api/staff/summary`, `src/pages/admin/AdminTeachers.tsx` |
| **4.1** | Calendario multi-sala (giorno affiancato / settimana), **Algoritmo Slot Liberi** + conversione 1-click in Corso Mirato, **Bacheca Pubblica** `/bacheca` | `computeFreeSlots()` in `server/services.ts`, `src/pages/admin/AdminCalendar.tsx`, `src/pages/PublicBoardPage.tsx` |
| **4.2** | Promemoria WhatsApp `wa.me` 1-click studenti, turni/solleciti insegnanti e **Generatore Broadcast Corsi Mirati** | `src/lib/format.ts`, `src/pages/admin/AdminWhatsApp.tsx`, `src/components/WhatsAppActionModal.tsx` |
| **4.3** | Appello mobile-first in 2 tocchi, banner rosso persistente, **Web Push** (`-60 min` / `+15 min`) e feed **Google Calendar `.ics`** con `VALARM` | `src/pages/staff/StaffPortal.tsx`, `server/push.ts`, `public/sw.js`, `generateTeacherIcsFeed()` in `server/services.ts` |
| **4.4** | Dashboard KPI Titolare (semaforo lezioni, code assenze/spostamenti, insoluti, alert rinnovo, analitica frequenza, matrice occupazione, ore docenti, audit log) | `buildAdminDashboard()` in `server/services.ts`, `src/pages/admin/AdminDashboard.tsx`, `src/pages/admin/AdminAuditExport.tsx` |
| **5** | PWA standalone installabile, database locale di pre-produzione + schema Supabase RLS, Real-Time WebSocket, export CSV/Excel | `public/manifest.webmanifest`, `public/sw.js`, `server/db.ts`, `server/realtime.ts`, `supabase/schema.sql` |

---

## 2. Architettura e Stack Tecnologico

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT PWA (Browser / Home Screen)                 │
│  React 19 · TypeScript · Tailwind CSS v4 · Service Worker (sw.js)          │
│                                                                            │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │  Portale Titolare   │  │ Portale Insegnante  │  │  Bacheca Pubblica  │  │
│  │      (ADMIN)        │  │  (STAFF mobile UX)  │  │  (/bacheca 0-login)│  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └─────────┬──────────┘  │
└─────────────┼────────────────────────┼───────────────────────┼─────────────┘
              │ HTTPS REST (/api/*)    │ WSS Real-Time (/ws)   │ Web Push / .ics
┌─────────────▼────────────────────────▼───────────────────────▼─────────────┐
│                   SERVER UNIFICATO NODE.JS 22 + EXPRESS 4                  │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────────────┐  │
│  │ Auth JWT + Cookie │ │ Domain Services  │ │ Realtime WS (/ws) con RLS  │  │
│  │ + RBAC / RLS API │ │ + Export CSV/XLS │ │ + Cron Push (-60m / +15m)  │  │
│  └────────┬─────────┘ └────────┬─────────┘ └─────────────┬──────────────┘  │
│           └────────────────────┼─────────────────────────┘                 │
│                                ▼                                           │
│       ┌─────────────────────────────────────────────────────────┐          │
│       │  DATABASE LOCALE SQLITE 3 (node:sqlite · WAL · FK ON)   │          │
│       │  data/pilates.sqlite · Trigger Hard · Vista RLS Staff   │          │
│       └─────────────────────────────────────────────────────────┘          │
│         (Migrazione cloud pronta in supabase/schema.sql con RLS)           │
└────────────────────────────────────────────────────────────────────────────┘
```

### Stack Tecnologico

- **Frontend:** React `19`, TypeScript `5.7`, Vite `6`, Tailwind CSS `4` (`@tailwindcss/vite`), icone `lucide-react`.
- **Design System Pilates:** Tipografia editoriale *Cormorant Garamond* (titoli) abbinata a *Plus Jakarta Sans* (interfaccia e dati tabellari), entrambe **self-hosted** tramite `@fontsource/*` (funzionanti offline e senza dipendenze da CDN esterne); palette lino caldo (`#F8F6F2`), salvia botanica (`#4A6759`) e terracotta (`#B86B52`).
- **PWA:** Web App Manifest (`display: standalone`, lingua `it`), set completo icone PNG/SVG (`192x192`, `512x512`, `maskable 512x512`, `apple-touch-icon 180x180`) e Service Worker (`public/sw.js`) con cache asset statici e gestione eventi `push` / `notificationclick`.
- **Backend:** Node.js `>= 22.5` (ESM), Express `4`, autenticazione `jsonwebtoken` + `bcryptjs` + `cookie-parser`, sincronizzazione real-time `ws`, notifiche VAPID `web-push`.
- **Database Locale (Pre-Produzione):** modulo nativo `node:sqlite` (`DatabaseSync`, zero compilazione di addon C++ esterni), journal `WAL`, `PRAGMA foreign_keys = ON`, `busy_timeout = 5000`, transazioni atomiche `BEGIN IMMEDIATE`, trigger SQL anti-conflitto e vista SQL isolata `staff_bookings_rls_view`.
- **Database Produzione (Opzione Cloud):** schema PostgreSQL/Supabase completo in `supabase/schema.sql` con estensioni `pgcrypto` e `btree_gist`, vincoli nativi `EXCLUDE USING gist`, policy RLS granulari e pubblicazione `supabase_realtime`.

---

## 3. Struttura Completa del Repository

```text
pwa-pilates/
├── PWA-gestionale-danza-sportiva-e-pilates.md   # Specifica Tecnica dei Requisiti Software (SRS)
├── README.md                                    # Documentazione tecnica e operativa
├── package.json                                 # Dipendenze e script npm
├── package-lock.json                            # Lockfile deterministico delle dipendenze
├── tsconfig.json                                # Configurazione TypeScript (client + shared)
├── tsconfig.server.json                         # Configurazione TypeScript (compilazione server -> dist/server)
├── vite.config.ts                               # Configurazione Vite 6 + Tailwind v4 (build -> dist/client)
├── index.html                                   # Entry HTML PWA (meta iOS/Android, manifest, icone)
│
├── shared/
│   └── types.ts                                 # Contratti TypeScript condivisi (viste RLS separate Admin/Staff)
│
├── server/
│   ├── index.ts                                 # Bootstrap HTTP + Express + WebSocket + Cron Push + Vite/Static
│   ├── db.ts                                    # Motore SQLite locale, DDL tabelle, indici, trigger, vista RLS, audit
│   ├── auth.ts                                  # JWT, cookie HttpOnly/CHIPS, normalizzazione E.164, middleware RBAC/RLS
│   ├── services.ts                              # Logica di dominio SRS (conflitti, crediti, slot liberi, KPI, .ics, CSV/XLS)
│   ├── routes.ts                                # Router REST completo /api/* (43 endpoint)
│   ├── realtime.ts                              # Server WebSocket /ws autenticato e filtrato per ruolo (RLS)
│   ├── push.ts                                  # Gestione chiavi VAPID, invio Web Push e scheduler -60m / +15m
│   ├── seed.ts                                  # Generatore dataset dimostrativo realistico ancorato alla data odierna
│   ├── reset-db.ts                              # Script CLI per il ripristino immediato del database locale
│   └── tests/
│       └── srs.test.ts                          # Suite automatica end-to-end (46 verifiche SRS su SQLite :memory:)
│
├── src/
│   ├── main.tsx                                 # Mount React 19 + registrazione Service Worker PWA
│   ├── App.tsx                                  # Shell applicativa, routing ruoli/bacheca, WebSocket e modali globali
│   ├── index.css                                # Tema Tailwind v4, font self-hosted, utility safe-area mobile
│   ├── lib/
│   │   ├── api.ts                               # Client HTTP autenticato multi-livello, download file, clipboard, WhatsApp
│   │   ├── format.ts                            # Formattatori italiani date/valuta, template messaggi wa.me, metadati stati
│   │   ├── pwa.ts                               # Registrazione SW, sottoscrizione VAPID Web Push, rilevamento iOS/standalone
│   │   └── realtime.ts                          # Hook React useRealtimeSync con riconnessione exponential backoff
│   ├── components/
│   │   ├── BrandMark.tsx                        # Monogramma Atelier Élan, icona WhatsApp, badge semaforo lezioni
│   │   ├── Modal.tsx                            # Finestra modale / bottom-sheet mobile accessibile (ESC, backdrop)
│   │   ├── Toast.tsx                            # Notifiche non invasive in-app (success / error / info)
│   │   ├── LessonDetailModal.tsx                # Dettaglio lezione Titolare: iscritti, appello, sblocco, modifica, elimina
│   │   └── WhatsAppActionModal.tsx              # Compositore rapido wa.me (modifica testo, copia, link diretto, conferma)
│   └── pages/
│       ├── LoginPage.tsx                        # Login Email+Password, Magic Link docenti e accesso rapido demo
│       ├── PublicBoardPage.tsx                  # Bacheca pubblica corsi mirati (/bacheca) + richiesta posto zero-login
│       ├── staff/
│       │   └── StaffPortal.tsx                  # Portale mobile-first Insegnante (Appello 2 tocchi, Agenda, Notifiche/.ics)
│       └── admin/
│           ├── AdminDashboard.tsx               # Dashboard direzionale Titolare (6 moduli KPI + code operative)
│           ├── AdminCalendar.tsx                # Calendario multi-sala, configurazione sale e rilevatore Slot Liberi
│           ├── AdminStudents.tsx                # Anagrafica studenti, note posturali, pacchetti, pagamenti e frequenza
│           ├── AdminTeachers.tsx                # Gestione insegnanti, monte ore validato e promemoria WhatsApp
│           ├── AdminWhatsApp.tsx                # Hub WhatsApp: richieste bacheca, promemoria domani e Broadcast Corsi Mirati
│           └── AdminAuditExport.tsx             # Audit Log filtrabile, export CSV/Excel/JSON/SQL, console DB e impostazioni
│
├── public/
│   ├── manifest.webmanifest                     # Manifest PWA installabile (standalone, portrait-primary, shortcuts)
│   ├── sw.js                                    # Service Worker (cache v2 asset statici + Web Push + notificationclick)
│   └── icons/                                   # icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
│
├── supabase/
│   └── schema.sql                               # Schema PostgreSQL/Supabase di produzione (EXCLUDE gist + RLS + Realtime)
│
└── data/                                        # Generata automaticamente al primo avvio (esclusa da Git tramite .gitignore)
    ├── pilates.sqlite                           # File principale database SQLite locale (+ file -wal / -shm)
    ├── secrets.json                             # Segreti locali auto-generati (jwtSecret, calendarKey) — permessi 0600
    └── vapid.json                               # Coppia chiavi VAPID Web Push auto-generata — permessi 0600
```

---

## 4. Requisiti, Installazione e Comandi Operativi

### Prerequisiti

- **Node.js `>= 22.5.0`** (testato su `v22.22.3` — necessario per il modulo nativo `node:sqlite`).
- **npm `>= 10`**.
- Nessun servizio esterno (né Docker, né PostgreSQL, né chiavi API WhatsApp) è richiesto per l'esecuzione locale: database SQLite, segreti JWT e chiavi VAPID vengono generati e inizializzati automaticamente al primo avvio.

### Installazione e Avvio

```bash
# 1. Installa le dipendenze
npm install

# 2a. Avvio in modalità sviluppo (server Express + Vite HMR + WebSocket + SQLite locale)
npm run dev

# 2b. Oppure compilazione e avvio in modalità produzione PWA (consigliato per testare Service Worker e cache)
npm run build
npm start
```

Una volta avviata, l'applicazione è raggiungibile su:

- **Gestionale (Titolare & Insegnanti):** `http://localhost:3000/`
- **Bacheca Disponibilità Pubblica (Allievi Zero-Login):** `http://localhost:3000/bacheca`
- **Health Check API:** `http://localhost:3000/api/health`

### Riepilogo Completo Script `package.json`

| Comando | Descrizione tecnica |
| --- | --- |
| `npm run dev` | Avvia `server/index.ts` tramite `tsx` con Vite in modalità middleware (HMR isolato su `/__vite_hmr` per non interferire con `/ws`). Crea e popola `data/pilates.sqlite` se vuoto. |
| `npm run build` | Esegue `vite build` (bundle frontend ottimizzato in `dist/client/`) seguito da `tsc -p tsconfig.server.json` (backend compilato in `dist/server/`). |
| `npm start` | Avvia il server compilato `dist/server/index.js` con `NODE_ENV=production`, servendo la PWA statica, le API `/api/*`, il WebSocket `/ws` e il cron-job notifiche sulla stessa porta. |
| `npm run typecheck` | Verifica rigorosa (`strict: true`) dei tipi TypeScript sia lato client/shared sia lato server senza emettere file. |
| `npm test` | Esegue `server/tests/srs.test.ts`: 46 test d'integrazione end-to-end su un database SQLite `:memory:` isolato (non modifica mai `data/pilates.sqlite`). |
| `npm run db:reset` | Svuota e ripopola `data/pilates.sqlite` con i dati dimostrativi iniziali ricalcolati rispetto alla data corrente, stampando il riepilogo delle credenziali. *(Eseguibile anche da interfaccia in **Audit, Export & DB → Database Locale & Studio → Ripristina Dati Demo**.)* |

---

## 5. Variabili d'Ambiente e File Runtime

Tutte le variabili d'ambiente sono **opzionali** in pre-produzione grazie a valori predefiniti sicuri:

| Variabile | Default | Descrizione |
| --- | --- | --- |
| `PORT` | `3000` | Porta TCP su cui il server HTTP + WebSocket si mette in ascolto. |
| `HOST` | `0.0.0.0` | Indirizzo di bind del server (`0.0.0.0` consente accesso da smartphone sulla stessa rete LAN o da proxy). |
| `NODE_ENV` | `development` / `production` | Impostata automaticamente da `npm run dev` e `npm start`. In `production` serve i file compilati in `dist/client`. |
| `PILATES_DB_PATH` | `./data/pilates.sqlite` | Percorso personalizzato del file database SQLite (utile per montare volumi persistenti dedicati). |
| `JWT_SECRET` | Auto-generato (96 hex char) | Segreto HMAC per la firma dei token JWT. Se omesso, viene generato con `crypto.randomBytes(48)` e persistito in `data/secrets.json` (permessi `0600`). |
| `CALENDAR_KEY` | Auto-generato (64 hex char) | Segreto applicativo ausiliario persistito in `data/secrets.json` (permessi `0600`). |

> **Sicurezza Git:** `.gitignore` esclude automaticamente `data/*.sqlite`, `data/*.sqlite-wal`, `data/*.sqlite-shm`, `data/secrets.json`, `data/vapid.json`, `.env` e `.env.local` così da non committare mai dati personali, note mediche o chiavi crittografiche.

---

## 6. Account Dimostrativi e Dataset di Pre-Produzione

Al primo avvio (se la tabella `users` è vuota), `server/seed.ts` popola il database con uno scenario completo e realistico ancorato alla settimana corrente:

### Credenziali di Accesso

| Ruolo | Nome | Email | Password | Metodi di accesso |
| --- | --- | --- | --- | --- |
| **Titolare (`ADMIN`)** | Elena Rossi | `elena.rossi@atelierpilates.it` | `Admin2026!` | Email + Password, pulsante rapido demo |
| **Insegnante 1 (`STAFF`)** | Giulia Ferretti *(verde salvia `#4A6759`)* | `giulia.ferretti@atelierpilates.it` | `Staff2026!` | Email + Password, **Magic Link**, pulsante rapido demo |
| **Insegnante 2 (`STAFF`)** | Camilla Conti *(terracotta `#B86B52`)* | `camilla.conti@atelierpilates.it` | `Staff2026!` | Email + Password, **Magic Link**, pulsante rapido demo |
| **Studente (Zero-Login)** | — | `/bacheca` | *Nessuna* | Accesso libero senza registrazione |

### Dati Pre-Caricati per il Collaudo Immediato

- **2 Sale configurate:**
  - *Sala 1 — Reformer* (capienza predefinita `6` posti — Reformer Balanced Body, Cadillac Tower, Stability Chair).
  - *Sala 2 — Matwork* (capienza predefinita `10` posti — parquet ammortizzato, sbarre in rovere, piccoli attrezzi).
- **12 Studenti** con numeri italiani in formato E.164 (`+39...`) e note mediche/posturali realistiche (es. ernia lombare L4-L5, diastasi addominale post-parto, secondo trimestre di gravidanza, scoliosi dorsale, conflitto sub-acromiale, cervicalgia) più allievi senza note per verificare entrambi i casi UI.
- **12 Pacchetti Lezioni** di tagli diversi (`5`, `8`, `10`, `12`, `15` crediti) che coprono tutti gli stati contabili e operativi:
  - Pacchetti interamente saldati (`PAID`), acconti parziali (`PARTIAL`) e da saldare (`UNPAID`).
  - Pacchetti in esaurimento (`1` o `2` lezioni residue) che attivano l'**Alert Rinnovo Pacchetti**.
- **Calendario Multi-Settimana dinamico** (settimana scorsa, oggi, resto della settimana e settimana successiva):
  - Lezioni già validate (`VERDE`), lezioni odierne in corso/future (`GIALLO`) e lezioni passate lasciate volutamente **non validate** (`ROSSO`) per testare subito il banner rosso docente, il sollecito WhatsApp e la chiusura/sblocco appello.
  - Prenotazioni in coda **`ABSENT_PENDING_DECISION`** (per testare i pulsanti 1-click **Scala** / **Congela**) e **`RESCHEDULE_REQUESTED`** con nota (per testare la riprogrammazione su uno slot futuro).
  - **Fasce pomeridiane libere** (`14:00–18:00`) lasciate libere in giorni feriali per testare l'algoritmo **Mostra Disponibilità** e la creazione 1-click di Corsi Mirati.
  - **4 Corsi Mirati futuri** (*Pilates in Gravidanza*, *Schiena Sana & Postura*, *Reformer Intermedio — Core & Control*, *Sbarra & Mobilità Articolare*) già pubblicati sulla Bacheca Pubblica `/bacheca`.
  - Storico **Audit Log** popolato con validazioni docenti, decisioni su assenze e registrazioni contabili.

---

## 7. Ruoli, Autenticazione e Sicurezza RLS

### Matrice dei Permessi (RBAC + Row-Level Security)

| Funzionalità / Dato | Titolare (`ADMIN`) | Insegnante (`STAFF`) | Pubblico (Zero-Login) |
| --- | :---: | :---: | :---: |
| Bacheca corsi mirati (`/bacheca`) e invio richiesta posto | Sì | Sì | **Sì** |
| Feed calendario `.ics` (tramite token segreto univoco) | Sì | Sì | Solo con token segreto |
| Lettura sale attive e calendario lezioni (coordinamento spazi) | Sì (anche sale inattive) | **Sì** (solo sale attive) | No |
| Creazione / modifica / eliminazione sale e lezioni | **Sì** | Bloccato (`403`) | Bloccato (`401`) |
| Lista iscritti (nome, cognome, note mediche/posturali) | Tutti i corsi | **Solo propri corsi** | Bloccato (`401`) |
| Telefono privato degli studenti e anagrafica completa | **Sì** | **Mai esposto** (`403` / escluso da vista SQL) | Bloccato (`401`) |
| Pacchetti, prezzi, pagamenti (`PAID`/`UNPAID`/`PARTIAL`), crediti residui | **Sì** | **Bloccato (`403 RLS_FORBIDDEN`)** | Bloccato (`401`) |
| Marcatura appello: `PRESENT`, `ABSENT_PENDING_DECISION`, `RESCHEDULE_REQUESTED` | Sì | **Solo propri corsi non chiusi** | Bloccato (`401`) |
| Decisione discrezionale assenza: `ABSENT_DEDUCTED` (Scala) / `ABSENT_FROZEN` (Congela) | **Sì** | **Bloccato (`403`)** | Bloccato (`401`) |
| Chiusura appello (`POST /api/lessons/:id/validate`) | Sì | **Solo propri corsi** | Bloccato (`401`) |
| Sblocco appello chiuso (`POST /api/lessons/:id/unlock`) | **Sì** | **Bloccato (`403`)** | Bloccato (`401`) |
| Monte ore validato docenti | Tutti i docenti | **Solo proprio monte ore** | Bloccato (`401`) |
| Dashboard KPI, Audit Log, Impostazioni, Export CSV/Excel, Reset DB | **Sì** | **Bloccato (`403`)** | Bloccato (`401`) |
| Eventi WebSocket su `packages`, `students`, `audit`, `settings`, `inquiries` | **Sì** | **Filtrati lato server (mai inviati)** | Bloccato (`401`) |

### Flussi di Autenticazione

1. **Email + Password (`POST /api/auth/login`):** password hashate con `bcryptjs` (salt rounds `10`); emissione token JWT firmato HS256 con validità `7 giorni`.
2. **Magic Link per Insegnanti (`POST /api/auth/magic-link` → `POST /api/auth/magic-verify`):**
   - Genera un token casuale a 256 bit (`32 byte`), salva nel database **solo il suo hash SHA-256** (`token_hash`) con scadenza a `30 minuti` e flag `used_at` monouso.
   - All'apertura di `/?magic=<token>`, `src/App.tsx` verifica e consuma automaticamente il link in un solo passaggio.
   - *(In pre-produzione locale il link viene mostrato direttamente nella schermata di login per consentire il test immediato senza server SMTP; in produzione basta inviare `magic_path` tramite provider email transazionale.)*
3. **Resilienza Sessione (Standalone PWA + Desktop + Iframe Cross-Origin):**
   - Lato server (`server/auth.ts`): cookie `elan_session` `HttpOnly` (con `SameSite=None; Secure; Partitioned` su HTTPS e `SameSite=Lax` su HTTP locale) più validazione ordinata di ogni token candidato (`X-Elan-Token`, `Authorization: Bearer`, query `_token` e cookie).
   - Lato client (`src/lib/api.ts`): memoria JS primaria supportata da `localStorage`, `sessionStorage` e `window.name` per garantire continuità anche nei browser con blocco rigoroso dello storage di terze parti.

### Isolamento Strutturale dei Dati Economici (`staff_bookings_rls_view`)

Quando un utente `STAFF` richiede gli iscritti di una propria lezione (`GET /api/lessons/:id/bookings`), il backend **non interroga mai la tabella `packages`** né legge colonne economiche: esegue la `SELECT` esclusivamente sulla vista SQL `staff_bookings_rls_view`, che espone solo:

`id`, `lesson_slot_id`, `assigned_teacher_id`, `student_id`, `student_first_name`, `student_last_name`, `student_medical_notes`, `attendance_status`, `reschedule_note`, `updated_at`.

Anche ispezionando il traffico di rete con gli strumenti sviluppatore o interrogando direttamente le API REST con un token `STAFF`, è strutturalmente impossibile risalire a prezzi, saldi, stato pagamenti, crediti residui o telefoni degli allievi.

---

## 8. Schema del Database Locale, Indici, Trigger e Viste

Il database locale risiede in `data/pilates.sqlite` (inizializzato da `server/db.ts`). Tutti i timestamp delle lezioni sono memorizzati in formato canonico **ISO-8601 UTC** (`YYYY-MM-DDTHH:mm:ss.sssZ`).

### Tabelle (11 totali)

#### 1. `users` *(SRS 2.1 — Utenti di Sistema)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `role` | `TEXT` | `NOT NULL CHECK (role IN ('ADMIN', 'STAFF'))` |
| `full_name` | `TEXT` | `NOT NULL` — Nome e cognome |
| `email` | `TEXT` | `NOT NULL UNIQUE COLLATE NOCASE` |
| `password_hash` | `TEXT` | `NOT NULL` — Hash bcrypt |
| `phone` | `TEXT` | `NOT NULL` — Numero WhatsApp in formato E.164 (`^\+[1-9]\d{6,14}$`) |
| `color` | `TEXT` | `NOT NULL DEFAULT '#4A6759'` — Colore identificativo docente nel calendario |
| `push_subscription` | `TEXT` | `DEFAULT NULL` — JSON sottoscrizione VAPID Web Push |
| `google_calendar_token` | `TEXT` | `DEFAULT NULL UNIQUE` — Token segreto 192-bit per il feed `.ics` |
| `created_at` | `TEXT` | `NOT NULL` — Timestamp ISO-8601 |

#### 2. `rooms` *(SRS 2.2 — Sale Fisiche dello Studio)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `name` | `TEXT` | `NOT NULL` (es. *Sala 1 — Reformer*, *Sala 2 — Matwork*) |
| `description` | `TEXT` | `NOT NULL DEFAULT ''` — Dotazione attrezzi |
| `default_capacity` | `INTEGER` | `NOT NULL CHECK (default_capacity >= 1)` — Capienza massima predefinita |
| `is_active` | `INTEGER` | `NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))` |

#### 3. `students` *(SRS 2.3 — Anagrafica Allievi Zero-Login)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `first_name` | `TEXT` | `NOT NULL` |
| `last_name` | `TEXT` | `NOT NULL` |
| `phone` | `TEXT` | `NOT NULL` — Validato e normalizzato E.164 (numeri italiani `3xxxxxxxxx` → `+393xxxxxxxxx`) |
| `medical_notes` | `TEXT` | `NOT NULL DEFAULT ''` — Note mediche/posturali visibili al docente durante l'appello |
| `created_at` | `TEXT` | `NOT NULL` |

#### 4. `packages` *(SRS 2.4 — Pacchetti Lezioni & Contabilità — Solo ADMIN)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `student_id` | `TEXT` | `NOT NULL REFERENCES students(id) ON DELETE CASCADE` |
| `name` | `TEXT` | `NOT NULL` (es. *Pacchetto 10 Lezioni Reformer*) |
| `total_credits` | `INTEGER` | `NOT NULL DEFAULT 10 CHECK (total_credits >= 1)` — Configurabile da impostazioni studio |
| `used_credits` | `INTEGER` | `NOT NULL DEFAULT 0 CHECK (used_credits >= 0 AND used_credits <= total_credits)` |
| `frozen_credits` | `INTEGER` | `NOT NULL DEFAULT 0 CHECK (frozen_credits >= 0)` — Lezioni congelate non scalate |
| `price` | `REAL` | `NOT NULL CHECK (price >= 0)` — Prezzo pattuito (€) |
| `payment_status` | `TEXT` | `NOT NULL CHECK (payment_status IN ('PAID', 'UNPAID', 'PARTIAL'))` |
| `amount_paid` | `REAL` | `NOT NULL DEFAULT 0 CHECK (amount_paid >= 0)` — Importo effettivamente incassato (€) |
| `purchase_date` | `TEXT` | `NOT NULL` (`YYYY-MM-DD`) |
| `expiration_date` | `TEXT` | `DEFAULT NULL` (`YYYY-MM-DD`, opzionale) |
| `status` | `TEXT` | `NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED'))` |

#### 5. `lesson_slots` *(SRS 2.5 — Singole Istanze di Lezione a Calendario)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `title` | `TEXT` | `NOT NULL` — Nome del corso |
| `teacher_id` | `TEXT` | `NOT NULL REFERENCES users(id) ON DELETE RESTRICT` |
| `room_id` | `TEXT` | `NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT` |
| `start_time` | `TEXT` | `NOT NULL` — Inizio ISO-8601 UTC |
| `end_time` | `TEXT` | `NOT NULL CHECK (end_time > start_time)` — Fine ISO-8601 UTC |
| `max_capacity` | `INTEGER` | `NOT NULL CHECK (max_capacity >= 1)` — Eredita da `rooms.default_capacity`, sovrascrivibile |
| `is_targeted` | `INTEGER` | `NOT NULL DEFAULT 0 CHECK (is_targeted IN (0, 1))` — Se `1`, pubblicato come *Corso Mirato* su `/bacheca` |
| `notes` | `TEXT` | `NOT NULL DEFAULT ''` — Descrizione corso / indicazioni |
| `series_id` | `TEXT` | `DEFAULT NULL` — Raggruppamento logico delle occorrenze ricorrenti (ciascuna resta indipendente) |
| `is_validated` | `INTEGER` | `NOT NULL DEFAULT 0 CHECK (is_validated IN (0, 1))` — Blocco appello chiuso |
| `validated_at` | `TEXT` | `DEFAULT NULL` — Timestamp esatto di validazione |
| `validated_by` | `TEXT` | `DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL` |

#### 6. `bookings` *(SRS 2.6 — Iscrizioni e Registro Presenze)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `lesson_slot_id` | `TEXT` | `NOT NULL REFERENCES lesson_slots(id) ON DELETE CASCADE` |
| `student_id` | `TEXT` | `NOT NULL REFERENCES students(id) ON DELETE CASCADE` |
| `package_id` | `TEXT` | `NOT NULL REFERENCES packages(id) ON DELETE CASCADE` |
| `attendance_status` | `TEXT` | `NOT NULL DEFAULT 'PENDING'` — Enum a 6 stati (vedi Sez. 9) |
| `reschedule_note` | `TEXT` | `DEFAULT NULL` — Nota spostamento/recupero (azzerata quando la riprogrammazione viene completata) |
| `updated_at` | `TEXT` | `NOT NULL` — Vincolo `UNIQUE (lesson_slot_id, student_id)` contro doppie iscrizioni |

#### 7. `audit_logs` *(SRS 2.7 — Registro Attività Immutabile)*
| Colonna | Tipo | Vincoli e note |
| --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` (UUID v4) |
| `actor_id` | `TEXT` | `NOT NULL REFERENCES users(id) ON DELETE CASCADE` |
| `action_type` | `TEXT` | `NOT NULL` — `ATTENDANCE_VALIDATED`, `ATTENDANCE_UPDATED`, `CREDIT_DEDUCTED`, `CREDIT_FROZEN`, `RESCHEDULE_REQUESTED`, `BOOKING_RESCHEDULED`, `BOOKING_ADDED`, `LESSON_UNLOCKED`, `LESSON_CREATED`, `LESSON_DELETED`, `PACKAGE_CREATED`, `PAYMENT_UPDATED`, `STUDENT_CREATED`, `TEACHER_CREATED`, `ROOM_CREATED` |
| `entity_id` | `TEXT` | `NOT NULL` — UUID dell'entità coinvolta |
| `metadata` | `TEXT` | `NOT NULL DEFAULT '{}'` — JSON con stato precedente/nuovo, corso, sala, allievo, conteggi |
| `created_at` | `TEXT` | `NOT NULL` — Timestamp esatto dell'operazione |

#### 8–11. Tabelle Operative di Supporto
- **`studio_settings`** (riga singola `id = 1`): `studio_name`, `studio_subtitle`, `studio_city`, `owner_whatsapp`, `min_package_credits` (default `1`), `max_package_credits` (default `30`), `default_package_credits` (default `10`), `renewal_alert_threshold` (default `2`).
- **`public_inquiries`**: richieste posto / lista d'attesa inviate senza login dalla Bacheca Pubblica (`id`, `lesson_slot_id`, `first_name`, `last_name`, `phone`, `notes`, `status` in `NEW | HANDLED`, `created_at`).
- **`magic_links`**: token monouso per login docenti (`id`, `user_id`, `token_hash` SHA-256 `UNIQUE`, `expires_at`, `used_at`, `created_at`).
- **`sent_notifications`**: deduplicazione notifiche automatiche (`lesson_slot_id`, `kind` in `PRE_60M | POST_15M`, `sent_at`, chiave primaria composta `(lesson_slot_id, kind)`).

### Trigger SQL Hard (6) e Indici (9)

- `trg_lesson_room_conflict_insert` & `trg_lesson_room_conflict_update` → abortiscono con `ROOM_CONFLICT` se esiste uno slot nella stessa `room_id` con `start_time < NEW.end_time AND end_time > NEW.start_time`.
- `trg_lesson_teacher_conflict_insert` & `trg_lesson_teacher_conflict_update` → abortiscono con `TEACHER_CONFLICT` se lo stesso `teacher_id` è già impegnato in un intervallo sovrapposto in qualsiasi sala.
- `trg_booking_capacity_insert` & `trg_booking_capacity_update` → abortiscono con `CAPACITY_EXCEEDED` se il numero di prenotazioni con `attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')` raggiunge `lesson_slots.max_capacity`.
- Indici dedicati su intervalli temporali, coppia `(room_id, start_time, end_time)`, coppia `(teacher_id, start_time, end_time)`, `bookings(lesson_slot_id)`, `bookings(package_id)`, `bookings(attendance_status)`, `packages(student_id)`, `audit_logs(created_at DESC)` e `public_inquiries(status, created_at DESC)`.

---

## 9. Regole di Business, Vincoli Hard e Macchina a Stati dei Crediti

### 9.1 Prevenzione Conflitti e Capienza (SRS 3.1)

- **Intervalli semi-aperti `[start_time, end_time)`:** due lezioni si sovrappongono se e solo se `start_A < end_B AND end_A > start_B`. Due corsi consecutivi (es. `10:00–11:00` e `11:00–12:00`) sono perfettamente ammessi senza falsi positivi.
- **Corsi ricorrenti atomici:** quando si crea un corso ripetuto per `N` settimane, tutte le `N` occorrenze vengono validate all'interno di un'unica transazione `BEGIN IMMEDIATE`: se anche una sola settimana genera conflitto di sala o docente, l'intera operazione viene annullata indicando esattamente data e corso in conflitto (`409 Conflict`).
- **Calcolo posti occupati:**
  $$\text{posti\_occupati} = \left|\{ b \in \text{bookings} \mid b.\text{status} \notin \{\texttt{ABSENT\_FROZEN}, \texttt{RESCHEDULE\_REQUESTED}\} \}\right|$$
  Congelare un'assenza o registrare una richiesta di spostamento libera immediatamente il posto nello slot originario.

### 9.2 Macchina a Stati Presenze e Scalabilità Crediti (SRS 3.2)

```text
  [Assegnazione Titolare]
            │
            ▼
        ┌─────────┐   (used_credits: +0, frozen_credits: +0 — occupa 1 posto)
        │ PENDING │
        └────┬────┘
             │ Appello Insegnante (o Titolare)
     ┌───────┼──────────────────────────────┐
     ▼       ▼                              ▼
 ┌─────────┐ ┌─────────────────────────┐ ┌──────────────────────┐
 │ PRESENT │ │ ABSENT_PENDING_DECISION │ │ RESCHEDULE_REQUESTED │
 └─────────┘ └────────────┬────────────┘ └──────────┬───────────┘
  used: +1     used: +0   │  Coda Titolare          │ used: +0 (posto liberato + nota)
  frozen: 0    frozen: 0  ├──────────────┐          │
                          ▼              ▼          ▼ [Titolare: Riprogramma su nuovo slot]
                ┌─────────────────┐ ┌───────────────┐
                │ ABSENT_DEDUCTED │ │ ABSENT_FROZEN │──► Nuova booking PENDING nello slot futuro
                └─────────────────┘ └───────────────┘
                 used: +1            used: +0
                 frozen: 0           frozen: +1 (posto liberato)
```

- **Zero deriva dei crediti (Credit Drift Prevention):** ogni transizione di stato calcola il differenziale esatto `deltaUsed = weight(nuovo) - weight(precedente)` e `deltaFrozen = frozenWeight(nuovo) - frozenWeight(precedente)` in transazione atomica. Anche quando la Titolare **sblocca un appello** e una presenza viene rettificata da `PRESENT` a `ABSENT_FROZEN` o `RESCHEDULE_REQUESTED`, il credito precedentemente scalato viene **riaccreditato automaticamente** (`used_credits - 1`) e lo stato del pacchetto si riallinea (`ACTIVE` / `EXHAUSTED` / `EXPIRED`).
- **Storno su cancellazione:** la rimozione di una prenotazione (`DELETE /api/bookings/:id`) o l'eliminazione di un intero slot (`DELETE /api/lessons/:id`) restituisce automaticamente ai rispettivi pacchetti eventuali crediti già scalati o congelati.
- **Chiusura e Sblocco Appello:**
  - `POST /api/lessons/:id/validate` richiede che **zero** iscritti siano ancora in stato `PENDING` (`400 PENDING_STUDENTS`), imposta `is_validated = 1`, salva `validated_at` e `validated_by`, e registra `ATTENDANCE_VALIDATED` in `audit_logs`.
  - Una lezione validata restituisce `403 LESSON_LOCKED` a qualsiasi tentativo di modifica da parte di un docente.
  - Solo `ADMIN` può invocare `POST /api/lessons/:id/unlock`, che riapre la scheda e registra `LESSON_UNLOCKED` nell'Audit Log.
  - Le decisioni amministrative post-appello della Titolare (`ABSENT_PENDING_DECISION → ABSENT_DEDUCTED / ABSENT_FROZEN` e riprogrammazione recuperi) restano eseguibili anche ad appello chiuso, senza dover riaprire il registro al docente.

### 9.3 Semaforo Stato Lezioni (SRS 4.4.1)

- **Verde (`GREEN`):** `is_validated = true` — appello regolarmente confermato e chiuso.
- **Giallo (`YELLOW`):** `is_validated = false` e `end_time >= ora_corrente` — lezione in corso o in programma.
- **Rosso (`RED`):** `is_validated = false` e `end_time < ora_corrente` — lezione conclusa con appello ancora aperto (attiva banner rosso sul portale docente e pulsante *Sollecita* in Dashboard Titolare).

### 9.4 Monte Ore Operativo Insegnanti (SRS 3.3)

Per ogni insegnante viene calcolata esclusivamente la somma delle durate `(end_time - start_time)` delle lezioni del mese corrente con `is_validated = 1` (affiancata dal totale ore pianificate e dal conteggio degli appelli da chiudere). In conformità alla SRS, non è presente alcun campo tariffa oraria, busta paga o compenso docenti.

---

## 10. Guida Dettagliata ai Moduli Funzionali

### 10.1 Portale Titolare (`ADMIN`)

Navigabile da barra laterale su desktop e da barra inferiore a 6 voci su smartphone/tablet:

1. **Dashboard & KPI (`AdminDashboard.tsx`):**
   - Striscia KPI riepilogativa (lezioni di oggi, azioni in coda, saldo da incassare su totale venduto, tasso di presenza globale, appelli scaduti).
   - **Semaforo Lezioni di Oggi:** cliccando una lezione si apre `LessonDetailModal`; sulle lezioni rosse compare il pulsante diretto **Sollecita** via WhatsApp.
   - **Coda Azioni Richieste:** pulsanti 1-click **Scala** e **Congela** per ogni assenza in attesa; pulsante **Riprogramma** per le richieste di spostamento con selettore degli slot futuri compatibili e posti residui.
   - **Pagamenti in Sospeso & Alert Rinnovo:** elenco pacchetti `UNPAID`/`PARTIAL` con saldo rapido 1-click (**Salda**) e sollecito WhatsApp; elenco pacchetti con crediti residui `<= renewal_alert_threshold` con proposta rinnovo WhatsApp.
   - **Analitica Frequenza Pacchetti:** ripartizione percentuale globale e tabellare per allievo tra *Presenze*, *Assenze Scalate*, *Lezioni Congelate* e *Residue*.
   - **Saturazione Sale & Fasce Orarie:** toggle *Questa Settimana / Ultimi 30 Giorni*, schede di utilizzo per sala, **heatmap Giorni (Lun–Sab) × Fasce Orarie (08:00–20:00)** e collegamento diretto al rilevatore Slot Liberi per valorizzare le fasce scariche.
   - **Monte Ore Insegnanti** del mese corrente e anteprima **Audit Log** recente.

2. **Calendario & Sale (`AdminCalendar.tsx`):**
   - **Vista Settimanale (Lun–Sab)** e **Vista Giornaliera Multi-Sala affiancata** (*Sala 1 — Reformer* | *Sala 2 — Matwork*), filtro rapido per insegnante con codifica colore, badge *Mirato*, semaforo e contatore `occupati/max`.
   - **+ Nuovo Corso:** creazione lezione singola o ricorrente settimanale (`1–24` settimane), capienza personalizzabile, flag *Pubblica come Corso Mirato* e note.
   - **Sale (`Configurazione Sale Studio`):** aggiunta nuove sale, modifica capienza predefinita e attivazione/disattivazione.
   - **Mostra Disponibilità (Algoritmo Slot Liberi):** ricerca automatica delle finestre libere configurando fascia oraria (default `14:00–18:00`), durata minima (`45/60/75/90 min`) e giorni della settimana, con indicazione delle sale e delle insegnanti libere e pulsante **Crea Corso Mirato** in 1 clic.
   - **Dettaglio Lezione (`LessonDetailModal.tsx`):** assegnazione studenti con scelta pacchetto attivo, marcatura presenze, **Conferma e Chiudi Appello**, **Sblocca Appello**, modifica orario/sala/docente/capienza ed eliminazione slot con storno crediti.

3. **Studenti & Pacchetti (`AdminStudents.tsx`):**
   - Ricerca istantanea per nome, cognome o telefono; evidenza visiva delle note mediche/posturali; creazione e modifica schede allievi.
   - Emissione nuovi pacchetti (rispettando `min_package_credits` e `max_package_credits` configurati), gestione acconti (`PARTIAL`), saldi (`PAID`), non saldati (`UNPAID`), date di scadenza, filtro per stato pagamento e barra grafica di avanzamento crediti.

4. **Insegnanti (`AdminTeachers.tsx`):**
   - Creazione e modifica profili `STAFF` (nome, email, telefono E.164, colore calendario, password), stato sottoscrizione Web Push, riepilogo ore validate del mese, lista appelli passati non ancora validati e pulsanti 1-click **Invia Riepilogo Turni** e **Sollecita Appello**.

5. **WhatsApp (`AdminWhatsApp.tsx`):**
   - **Richieste Posto dalla Bacheca Pubblica:** elenco in tempo reale delle richieste inviate dagli allievi su `/bacheca` (con badge numerico nel menu), pulsante **Iscrivi al Corso** in 1 clic (associa l'allievo esistente col suo pacchetto attivo oppure registra il nuovo allievo creando un *Ingresso Corso Mirato* da saldare), **Rispondi WA** e **Archivia**.
   - **Promemoria Lezione Studenti (1-Click):** selettore data (preimpostato su *Domani*), raggruppamento per corso e invio/copia promemoria personalizzato con spunta di stato *Inviato*.
   - **Generatore Broadcast Corsi Mirati & Slot Liberi:** selezione tramite checkbox dei corsi mirati e delle fasce pomeridiane libere, generazione automatica del testo promozionale (modificabile), copia per Liste Broadcast e inoltro su WhatsApp, più copia link `/bacheca`.

6. **Audit, Export & DB (`AdminAuditExport.tsx`):**
   - **Audit Log Attività:** registro cronologico filtrabile per operatore (Titolare o singola Insegnante) e per tipo di azione, con timestamp esatto e dettaglio transizioni.
   - **Export CSV / Excel:** download autenticato di cartella Excel multi-foglio (`.xls`), CSV incassi, CSV pacchetti, CSV presenze e backup JSON integrale.
   - **Database Locale & Studio:** stato e dimensione del file SQLite (incluso WAL), conteggio record per tabella, download dello schema SQL PostgreSQL/Supabase, pulsante **Ripristina Dati Demo** con doppia conferma, e form di configurazione parametri studio e pacchetti.

### 10.2 Portale Insegnante Mobile-First (`STAFF` — `StaffPortal.tsx`)

- **Tab Appello (Regola dei 2 Tocchi):**
  - Banner rosso persistente in cima per qualsiasi lezione passata non ancora validata.
  - Apertura automatica del primo appello urgente; per ogni iscritto mostra nome, cognome, box evidenziato delle **note mediche/posturali** e 3 grandi pulsanti touch: **Presente**, **Assente**, **Sposta** (con campo nota opzionale).
  - Pulsante finale **Conferma e Chiudi Appello** (abilitato non appena tutti gli iscritti sono marcati), che blocca la scheda in sola lettura.
- **Tab Agenda:** vista settimanale con selettore **I Miei Turni** / **Tutte le Sale** (per il coordinamento degli spazi condivisi) e riepilogo personale del monte ore validato nel mese.
- **Tab Avvisi & Sync:** attivazione/disattivazione **Notifiche Web Push** con pulsante **Invia Notifica di Test**, guida dedicata per iPhone/iPad (iOS 16.4+), URL del feed dinamico `.ics`, pulsante **Aggiungi a Google Calendar**, download diretto `.ics` e rigenerazione del token segreto.

### 10.3 Bacheca Disponibilità Pubblica (`PublicBoardPage.tsx` — `/bacheca`)

- Accessibile senza autenticazione da qualsiasi link condiviso su WhatsApp o social.
- Mostra i prossimi **Corsi Mirati** con filtro per sala, data, fascia oraria, nome dell'insegnante, descrizione e badge posti disponibili (*X posti liberi su Y* oppure *Completo — Lista d'attesa*).
- Il pulsante **Richiedi Posto** / **Lista d'attesa** permette sia l'invio immediato zero-login della richiesta alla segreteria (con notifica real-time alla Titolare), sia l'apertura/copia del messaggio diretto WhatsApp `wa.me` precompilato.

---

## 11. Alerting Multi-Canale, Real-Time WebSocket e PWA

### 11.1 Web Push Notifications e Scheduler Server-Side (`server/push.ts`)

- Al primo avvio viene generata una coppia di chiavi **VAPID** in `data/vapid.json`.
- `startReminderCronJob()` esegue un controllo ogni **60 secondi**:
  1. **`PRE_60M` (finestra `[now + 55m, now + 65m]`):** invia all'insegnante assegnata il promemoria del turno in partenza con orario e sala.
  2. **`POST_15M` (finestra `[now - 45m, now - 15m]` con `is_validated = 0`):** invia all'insegnante il sollecito a confermare e chiudere l'appello.
- La tabella `sent_notifications` impedisce invii duplicati per la stessa lezione.
- Ogni notifica viene recapitata sia tramite **Web Push VAPID** (anche ad app chiusa tramite `public/sw.js`) sia come **avviso real-time in-app** su WebSocket se il portale è aperto; le sottoscrizioni revocate (`404`/`410`) vengono ripulite automaticamente.

### 11.2 Sincronizzazione Google Calendar / iCalendar (`.ics`)

- Endpoint `GET /api/calendar/:token/feed.ics` (`text/calendar; charset=utf-8`).
- Espone i turni dell'insegnante (da `-14` a `+90` giorni) con stato di validazione e **due allarmi `VALARM` nativi** per ogni evento `VEVENT`:
  - `TRIGGER:-PT60M` — 60 minuti prima dell'inizio lezione.
  - `TRIGGER;RELATED=END:PT15M` — 15 minuti dopo la fine della lezione per ricordare la chiusura dell'appello.
- Il token può essere revocato e rigenerato in qualsiasi momento con `POST /api/calendar/regenerate-token`.

### 11.3 Real-Time Sync WebSocket (`server/realtime.ts` & `src/lib/realtime.ts`)

- Canale `ws(s)://<host>/ws` autenticato all'handshake HTTP `Upgrade`.
- Tipi di evento JSON: `CONNECTED`, `SYNC` (`entity`, `action`, `lesson_slot_id`, `message`, `timestamp`), `PUSH_ALERT`.
- Heartbeat server `ping` ogni `30s`; riconnessione automatica client con backoff esponenziale (`1.2s` → max `12s`).
- **RLS Real-Time:** gli eventi relativi a `packages`, `students`, `audit`, `settings` e `inquiries` non vengono mai trasmessi alle connessioni con ruolo `STAFF`.

### 11.4 Installazione PWA e Strategia Cache (`public/sw.js`)

- **Android (Chrome / Edge):** tocca il pulsante *Installa App PWA* nell'interfaccia oppure il menu del browser → *Installa app*.
- **iOS / iPadOS 16.4+ (Safari):** tocca l'icona *Condividi* → *Aggiungi alla schermata Home* → apri l'app dall'icona installata per abilitare anche le notifiche Web Push native.
- **Desktop (Chrome / Edge):** clicca l'icona di installazione nella barra degli indirizzi.
- **Sicurezza Cache:** `public/sw.js` applica *Network-First* con fallback offline sulle navigazioni HTML e *Stale-While-Revalidate* solo su `/assets/*` e `/icons/*` (inclusi i font self-hosted), **escludendo tassativamente** `/api/*` e `/ws` così da non memorizzare mai dati sensibili o stantii in cache.

---

## 12. Riferimento Completo API REST e Codici di Errore

Tutte le risposte JSON includono `Cache-Control: no-store, no-cache, must-revalidate, private`.

### Endpoint Pubblici e Autenticazione

| Metodo | Endpoint | Accesso | Descrizione |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Pubblico | Stato del server, motore DB attivo e timestamp UTC. |
| `GET` | `/api/public/availability` | Pubblico | Dati studio e prossimi Corsi Mirati con posti residui live. |
| `POST` | `/api/public/inquiries` | Pubblico | Invia richiesta posto / lista d'attesa zero-login dalla bacheca. |
| `GET` | `/api/calendar/:token/feed.ics` | Token `.ics` | Feed dinamico iCalendar turni docente con `VALARM` `-60m` e `+15m`. |
| `POST` | `/api/auth/login` | Pubblico | Login Email + Password; restituisce `{ token, user }` e imposta cookie `HttpOnly`. |
| `POST` | `/api/auth/magic-link` | Pubblico | Genera Magic Link monouso (validità 30 min) per account `STAFF`. |
| `POST` | `/api/auth/magic-verify` | Pubblico | Verifica e consuma il Magic Link; avvia la sessione. |
| `POST` | `/api/auth/logout` | Pubblico | Cancella il cookie di sessione. |
| `GET` | `/api/auth/me` | `AUTH` | Restituisce profilo utente autenticato e token attivo. |

### Notifiche Push, Calendario, Sale e Staff

| Metodo | Endpoint | Accesso | Descrizione |
| --- | --- | --- | --- |
| `GET` | `/api/push/vapid-public-key` | `AUTH` | Chiave pubblica VAPID per `pushManager.subscribe()`. |
| `POST` | `/api/push/subscribe` | `AUTH` | Salva la sottoscrizione Web Push del dispositivo corrente. |
| `DELETE` | `/api/push/subscribe` | `AUTH` | Rimuove la sottoscrizione Web Push dell'utente. |
| `POST` | `/api/push/test` | `AUTH` | Invia immediatamente una notifica Web Push + alert in-app di prova. |
| `POST` | `/api/calendar/regenerate-token` | `AUTH` | Rigenera il token segreto del feed `.ics` invalidando il precedente. |
| `GET` | `/api/rooms` | `AUTH` | Elenco sale (`?all=true` include sale disattivate, solo `ADMIN`). |
| `POST` | `/api/rooms` | `ADMIN` | Crea una nuova sala fisica con capienza predefinita. |
| `PATCH` | `/api/rooms/:id` | `ADMIN` | Aggiorna nome, descrizione, capienza o stato `is_active` di una sala. |
| `GET` | `/api/teachers` | `AUTH` | Elenco insegnanti (completo con ore/telefoni per `ADMIN`; ridotto per `STAFF`). |
| `POST` | `/api/teachers` | `ADMIN` | Crea un nuovo profilo insegnante (`STAFF`) con token `.ics` dedicato. |
| `PATCH` | `/api/teachers/:id` | `ADMIN` | Modifica dati, colore, telefono o password di un'insegnante. |
| `GET` | `/api/staff/summary` | `AUTH` | Lezioni passate non validate, lezioni di oggi e monte ore validato del mese. |

### Calendario Lezioni, Slot Liberi, Prenotazioni e Appelli

| Metodo | Endpoint | Accesso | Descrizione |
| --- | --- | --- | --- |
| `GET` | `/api/lessons` | `AUTH` | Lista slot filtrabile per `from`, `to`, `teacherId`, `roomId`, `targeted`, `unvalidatedPast`. |
| `GET` | `/api/lessons/free-slots` | `ADMIN` | Calcola finestre libere (`startDate`, `endDate`, `windowStart`, `windowEnd`, `minDuration`, `weekdays`, `roomId`, `teacherId`). |
| `POST` | `/api/lessons` | `ADMIN` | Crea lezione singola o ricorrente (`repeat_weeks`) con controllo hard conflitti. |
| `PATCH` | `/api/lessons/:id` | `ADMIN` | Modifica singola istanza lezione (verifica conflitti e capienza attuale). |
| `DELETE` | `/api/lessons/:id` | `ADMIN` | Elimina slot e storna in transazione eventuali crediti già scalati/congelati. |
| `GET` | `/api/lessons/:id/bookings` | `AUTH` | Iscritti allo slot (vista completa per `ADMIN`; vista RLS isolata solo propri corsi per `STAFF`). |
| `POST` | `/api/lessons/:id/bookings` | `ADMIN` | Assegna studente a lezione (`PENDING`) verificando capienza e crediti pacchetto. |
| `PATCH` | `/api/bookings/:id/attendance` | `AUTH` | Aggiorna stato presenza e ricalcola atomicamente `used_credits` / `frozen_credits`. |
| `POST` | `/api/bookings/:id/reschedule` | `ADMIN` | Riprogramma un'assenza congelata/spostamento su un nuovo `target_lesson_slot_id`. |
| `DELETE` | `/api/bookings/:id` | `ADMIN` | Rimuove iscrizione (se appello aperto) e riaccredita eventuali crediti scalati. |
| `POST` | `/api/lessons/:id/validate` | `AUTH` | Conferma e chiude l'appello (`is_validated = true`) e scrive in `audit_logs`. |
| `POST` | `/api/lessons/:id/unlock` | `ADMIN` | Sblocca un appello chiuso (`is_validated = false`) e scrive in `audit_logs`. |

### Studenti, Pacchetti, Richieste Bacheca, KPI, Audit, Export e DB

| Metodo | Endpoint | Accesso | Descrizione |
| --- | --- | --- | --- |
| `GET` | `/api/students` | `ADMIN` | Anagrafica completa studenti con riepilogo pacchetto attivo. |
| `POST` | `/api/students` | `ADMIN` | Registra nuovo studente (con normalizzazione/validazione E.164). |
| `PATCH` | `/api/students/:id` | `ADMIN` | Aggiorna dati anagrafici, telefono e note mediche/posturali. |
| `DELETE` | `/api/students/:id` | `ADMIN` | Elimina scheda studente e relative associazioni. |
| `GET` | `/api/packages` | `ADMIN` | Lista pacchetti con statistiche frequenza (filtrabile per `studentId`, `paymentStatus`, `status`). |
| `POST` | `/api/packages` | `ADMIN` | Emette nuovo pacchetto lezioni con configurazione prezzo e stato pagamento. |
| `PATCH` | `/api/packages/:id` | `ADMIN` | Aggiorna pagamento (`PAID`/`PARTIAL`/`UNPAID`), importo versato, crediti o scadenza. |
| `DELETE` | `/api/packages/:id` | `ADMIN` | Elimina pacchetto lezioni. |
| `GET` | `/api/inquiries` | `ADMIN` | Elenco richieste posto dalla Bacheca Pubblica (`?status=NEW` opzionale). |
| `PATCH` | `/api/inquiries/:id` | `ADMIN` | Archivia richiesta o iscrive direttamente il richiedente al corso (`enroll: true`). |
| `GET` | `/api/dashboard/admin` | `ADMIN` | Payload completo Dashboard KPI (`?period=week\|month`). |
| `GET` | `/api/audit-logs` | `ADMIN` | Registro attività filtrabile per `actorId`, `actionType`, `limit`. |
| `GET` / `PATCH` | `/api/settings` | `ADMIN` | Lettura e salvataggio impostazioni studio, WhatsApp titolare e soglie pacchetti. |
| `GET` | `/api/export/revenue.csv` | `ADMIN` | Esportazione CSV (UTF-8 BOM, separatore `;`) registro incassi e saldi. |
| `GET` | `/api/export/packages.csv` | `ADMIN` | Esportazione CSV registro pacchetti, crediti e assenze. |
| `GET` | `/api/export/attendance.csv` | `ADMIN` | Esportazione CSV registro cronologico presenze e validazioni. |
| `GET` | `/api/export/contabilita.xls` | `ADMIN` | Cartella Excel SpreadsheetML a 3 fogli (*Registro Incassi*, *Registro Pacchetti*, *Registro Presenze*). |
| `GET` | `/api/export/backup.json` | `ADMIN` | Snapshot JSON integrale di tutte le tabelle locali. |
| `GET` | `/api/export/supabase-schema.sql` | `ADMIN` | Download diretto di `supabase/schema.sql`. |
| `POST` | `/api/admin/db/reset-demo` | `ADMIN` | Ripristina `data/pilates.sqlite` ai dati demo e rinnova il token della Titolare. |

### Codici di Errore Applicativi Principali

| HTTP | `code` | Significato |
| --- | --- | --- |
| `400` | `INVALID_PHONE` | Numero di telefono non conforme allo standard internazionale E.164. |
| `400` | `PENDING_STUDENTS` | Tentativo di chiudere un appello mentre uno o più iscritti sono ancora `PENDING`. |
| `400` | `NO_CREDITS` / `PACKAGE_EXPIRED` | Pacchetto senza crediti disponibili o oltre la data di scadenza. |
| `401` | `AUTH_REQUIRED` / `AUTH_INVALID` | Token assente, scaduto o non valido. |
| `403` | `RLS_FORBIDDEN` | Violazione policy di sicurezza: ruolo `STAFF` su risorsa economica/amministrativa o corso altrui. |
| `403` | `LESSON_LOCKED` | Tentativo di modificare un appello già validato senza sblocco della Titolare. |
| `409` | `ROOM_CONFLICT` | Sovrapposizione oraria nella stessa sala. |
| `409` | `TEACHER_CONFLICT` | Sovrapposizione oraria della stessa insegnante su sale diverse. |
| `409` | `CAPACITY_EXCEEDED` | Raggiunta la capienza massima attiva della lezione. |
| `409` | `DUPLICATE_BOOKING` | Studente già iscritto allo stesso slot orario. |

---

## 13. Esportazione Contabile e Backup dei Dati

Dalla sezione **Audit, Export & DB → Export CSV / Excel** la Titolare può scaricare in qualsiasi momento:

1. **`contabilita-atelier-elan.xls`** — Cartella Excel pronta per il commercialista composta da 3 fogli separati e formattati (*Registro Incassi*, *Registro Pacchetti*, *Registro Presenze*).
2. **`registro-incassi-pilates.csv`** — Importi pattuiti, versati, residui da incassare e stato pagamento.
3. **`registro-pacchetti-pilates.csv`** — Crediti totali, usati, congelati, residui, stato e date acquisto/scadenza.
4. **`registro-presenze-pilates.csv`** — Storico presenze per data, orario, corso, sala, docente, allievo, stato e timestamp validazione.
5. **`backup-locale-pilates.json`** — Dump strutturato completo del database locale per archiviazione di sicurezza.

> Tutti i file CSV includono il **BOM UTF-8 (`\uFEFF`)** e il delimitatore `;` standard italiano, così da aprirsi direttamente in Microsoft Excel, LibreOffice Calc e Apple Numbers con lettere accentate (`à, è, é, ì, ò, ù`) e decimali perfettamente leggibili.

---

## 14. Suite di Test Automatici End-to-End

Il comando `npm test` avvia un'istanza completa del server HTTP + Express + WebSocket collegata a un database SQLite in memoria (`:memory:`) ed esegue **46 asserzioni end-to-end** suddivise in 6 aree:

1. **Autenticazione (SRS 1):** login `ADMIN` email+password, login `STAFF` email+password, generazione e verifica monouso **Magic Link** per insegnante.
2. **Sicurezza Row-Level Security (SRS 1 & 5):** blocco `403` di `STAFF` su `/api/packages`, `/api/students`, `/api/audit-logs`, `/api/dashboard/admin`, `/api/inquiries` e `/api/export/revenue.csv`; verifica assenza totale di `package_id`, prezzi, pagamenti, crediti e telefoni nella risposta iscritti `STAFF`; presenza note posturali; blocco `403` sui corsi di altre docenti.
3. **Vincoli Hard (SRS 3.1):** creazione lezione valida, rifiuto `409 ROOM_CONFLICT`, rifiuto `409 TEACHER_CONFLICT`, ammissione intervalli contigui `[10:00, 11:00)` + `[11:00, 12:00)`, rifiuto `409 CAPACITY_EXCEEDED`.
4. **Real-Time WebSocket & Macchina a Stati Crediti (SRS 3.2 & 5):** ricezione evento WebSocket su aggiunta studente; `0` crediti scalati in `PENDING`; blocco validazione con `PENDING` aperti; `+1 used_credits` su `PRESENT`; coda `ABSENT_PENDING_DECISION` senza addebito; blocco `403` su `ABSENT_DEDUCTED` da `STAFF`; blocco `403 LESSON_LOCKED` dopo validazione; blocco `403` su `/unlock` da `STAFF`; `ABSENT_FROZEN` (`+1 frozen_credits`) e riprogrammazione su nuovo slot; sblocco Titolare e rettifica presenza con ripristino esatto del credito (`used_credits = 0`); filtraggio RLS degli eventi `packages` sul WebSocket `STAFF`.
5. **Slot Liberi, Bacheca Pubblica, `.ics`, KPI ed Export (SRS 4 & 5):** rilevamento fasce libere `14:00–18:00`, bacheca pubblica senza login, presenza di entrambi i `VALARM` (`-PT60M` e `TRIGGER;RELATED=END:PT15M`) nel feed `.ics`, integrità dei 6 moduli KPI Dashboard, validazione contenuti CSV ed Excel.
6. **Resilienza Iframe/Proxy, CRUD Sale/Staff e Flusso Richiesta Posto:** cookie `SameSite=None; Secure; Partitioned` su HTTPS, autenticazione con header `X-Elan-Token`, creazione nuova sala, creazione nuova insegnante, richiesta posto zero-login su `/api/public/inquiries` e iscrizione 1-click da parte della Titolare.

---

## 15. Passaggio in Produzione e Migrazione PostgreSQL/Supabase

Sono supportati due percorsi di messa in produzione, a seconda della dimensione e delle preferenze dello studio:

### Opzione A — Deploy Diretto Self-Hosted / VPS (SQLite WAL Persistente)

Ideale per un singolo studio (1 Titolare + insegnanti + centinaia di allievi), con costi infrastrutturali minimi e latenza sub-millisecondo:

1. Provisiona un server Linux con **Node.js 22 LTS** e un reverse proxy **HTTPS** obbligatorio (es. Caddy o Nginx con Let's Encrypt — HTTPS è requisito indispensabile per Service Worker e Web Push).
2. Configura il reverse proxy per inoltrare sia il traffico HTTP sia l'upgrade WebSocket (`Upgrade` / `Connection`) su `127.0.0.1:3000` con header `X-Forwarded-Proto: https`.
3. Imposta `NODE_ENV=production`, `PILATES_DB_PATH=/var/lib/atelier-elan/pilates.sqlite` e un `JWT_SECRET` casuale ad alta entropia; esegui `npm ci && npm run build && npm start` sotto `systemd` o `pm2`.
4. Al primo accesso in produzione:
   - Modifica email, password e numero WhatsApp della Titolare (`studio_settings` e `users`).
   - Aggiorna il contatto `mailto:` VAPID in `server/push.ts` con l'email reale dello studio.
   - Pianifica un backup giornaliero automatico del file SQLite (es. `sqlite3 pilates.sqlite ".backup backup-$(date +%F).sqlite"`) oltre all'export periodico Excel/JSON da interfaccia.
   - Collega un servizio SMTP/transazionale in `POST /api/auth/magic-link` (`server/routes.ts`) per recapitare i Magic Link via email senza esporre `magic_path` nella risposta JSON.

### Opzione B — Migrazione Cloud a Supabase / PostgreSQL (SRS Sez. 5)

Quando si desidera un'infrastruttura cloud gestita multi-istanza:

1. Crea un nuovo progetto su **Supabase** (regione EU, es. Francoforte/Milano per conformità GDPR).
2. Apri il **SQL Editor** di Supabase ed esegui integralmente [`supabase/schema.sql`](./supabase/schema.sql) (scaricabile anche dall'app in *Audit, Export & DB → Schema SQL Produzione*):
   - Abilita `pgcrypto` e `btree_gist`.
   - Crea tutte le tabelle con vincoli nativi `EXCLUDE USING gist` su `tstzrange(start_time, end_time, '[)')` per conflitto sala e docente, trigger capienza, vista `staff_bookings_rls_view`, policy **Row-Level Security** complete per `ADMIN`/`STAFF`/pubblico e pubblicazione `supabase_realtime`.
3. Esporta i dati eventualmente già inseriti in pre-produzione tramite `GET /api/export/backup.json` e importali nelle corrispondenti tabelle PostgreSQL.
4. Sostituisci il layer di accesso dati (`server/db.ts`) con il client `@supabase/supabase-js` / `pg` e configura Supabase Auth per l'invio nativo dei Magic Link e Supabase Edge Functions (o `pg_cron`) per i trigger Web Push `-60 min` e `+15 min`.

---

## 16. Risoluzione dei Problemi (Troubleshooting)

- **Errore `Cannot find module 'node:sqlite'`:** stai usando una versione di Node.js precedente alla `22.5`. Verifica con `node -v` e passa a Node.js `22 LTS`.
- **Le notifiche Web Push non compaiono su iPhone/iPad:** su iOS (dalla versione `16.4` in poi) Apple consente le Web Push **solo** se la PWA è stata prima aggiunta alla schermata Home da Safari (*Condividi → Aggiungi alla schermata Home*) e aperta dalla relativa icona. In ogni caso il feed **Google Calendar / Calendario Apple (`.ics`)** fornisce sempre i due avvisi nativi a `-60 min` e `+15 min`.
- **Aggiornamento dell'interfaccia dopo una nuova build:** il Service Worker si aggiorna automaticamente (`skipWaiting` + `clients.claim`); se il browser mostra una versione precedente, esegui un ricaricamento forzato (`Ctrl+Shift+R` / `Cmd+Shift+R`).
- **Ripristino ambiente pulito di test:** esegui `npm run db:reset` da terminale (oppure usa il pulsante *Ripristina Dati Demo* in *Audit, Export & DB → Database Locale & Studio*) per riportare istantaneamente sale, studenti, pacchetti, lezioni e audit log allo stato dimostrativo iniziale.
