# Progressive Web App (PWA) gestionale per lo studio di Danza Sportiva e Pilates.

**Specifica Tecnica dei Requisiti Software (SRS)** consolidata per la realizzazione della Progressive Web App (PWA) gestionale per lo studio di Danza Sportiva e Pilates.


# **Specifica Tecnica dei Requisiti Software (SRS)**

**Progetto:** Gestionale Operativo PWA — Studio Pilates e Danza Sportiva

**Target:** Sviluppatori Full-Stack / Software Architect

**Architettura Target:** Progressive Web App (PWA), Mobile-First per staff, Serverless / Real-Time Database.


## 1. Perimetro del Sistema e Attori

Il sistema è progettato attorno a tre ruoli, di cui solo due autenticati:


<table>
  <tr>
   <td><strong>Ruolo</strong>
   </td>
   <td><strong>Autenticazione</strong>
   </td>
   <td><strong>Permessi e Visibilità</strong>
   </td>
  </tr>
  <tr>
   <td><strong>Titolare (Admin)</strong>
   </td>
   <td>Email + Password (o OAuth)
   </td>
   <td>Accesso totale in lettura/scrittura a tutte le entità, dati economici studenti, configurazione sale/corsi, log di audit e sblocco appelli.
   </td>
  </tr>
  <tr>
   <td><strong>Insegnante (Staff)</strong>
   </td>
   <td>Email + Password / Magic Link
   </td>
   <td>Accesso ristretto. Vede tutte le sale e i propri corsi assegnati (con anagrafica iscritti e note posturali). Esegue la validazione presenze. <strong>Nessuna visibilità</strong> su prezzi, pacchetti acquistati, stati di pagamento o compiti amministrativi.
   </td>
  </tr>
  <tr>
   <td><strong>Studente (End-User)</strong>
   </td>
   <td>Nessuna (Zero-Login)
   </td>
   <td>Non accede all'applicazione. Riceve comunicazioni tramite link diretti WhatsApp generati dalla Titolare.
   </td>
  </tr>
</table>



## 2. Architettura Dati (Database Schema Logico)

Per garantire la sincronizzazione in tempo reale e l'integrità referenziale, il database deve implementare le seguenti entità principali:


### **2.1 **users** (Utenti di Sistema)**



* id: UUID (Primary Key)
* role: ENUM (ADMIN, STAFF)
* full_name: String
* email: String (Unique)
* phone: String (Formato E.164, es. +39333... per promemoria WhatsApp)
* push_subscription: JSONB (Token per Web Push Notifications)
* google_calendar_token: String (Encrypted, opzionale per sync calendario docente)


### **2.2 **rooms** (Sale)**



* id: UUID (Primary Key)
* name: String (es. "Sala 1 - Reformer", "Sala 2 - Matwork")
* default_capacity: Integer (Capienza massima standard della sala)
* is_active: Boolean


### **2.3 **students** (Anagrafica Studenti)**



* id: UUID (Primary Key)
* first_name: String
* last_name: String
* phone: String (Formato E.164 obbligatorio per generazione URL wa.me)
* medical_notes: Text (Visibile ai docenti per precauzioni fisiche/posturali)
* created_at: Timestamp


### **2.4 **packages** (Pacchetti Lezioni)**



* id: UUID (Primary Key)
* student_id: UUID (Foreign Key -> students.id)
* name: String (es. "Pacchetto 10 Lezioni Pilates")
* total_credits: Integer (Default: 10, configurabile con min/max liberamente)
* used_credits: Integer (Default: 0 — incrementato solo da presenze o assenze scalate)
* frozen_credits: Integer (Default: 0 — tracciamento assenze congelate/da recuperare)
* price: Decimal (10,2)
* payment_status: ENUM (PAID, UNPAID, PARTIAL)
* amount_paid: Decimal (10,2)
* purchase_date: Date
* expiration_date: Date (Nullable)
* status: ENUM (ACTIVE, EXHAUSTED, EXPIRED)


### **2.5 **lesson_slots** (Singole Occorrenze di Lezione)**

*Nota architetturale: Anche se la Titolare crea corsi ricorrenti, il DB deve istanziare singoli record *lesson_slots* per gestire agilmente spostamenti, sostituzioni di sala/docente e validazioni puntuali.*



* id: UUID (Primary Key)
* title: String (es. "Pilates Posturale", "Corso Mirato Pomeridiano")
* teacher_id: UUID (Foreign Key -> users.id)
* room_id: UUID (Foreign Key -> rooms.id)
* start_time: Timestamp with Time Zone
* end_time: Timestamp with Time Zone
* max_capacity: Integer (Ereditato da rooms.default_capacity o sovrascritto per lo specifico corso)
* is_validated: Boolean (Default: false — diventa true quando il docente chiude l'appello)
* validated_at: Timestamp (Nullable)
* validated_by: UUID (Foreign Key -> users.id, Nullable)


### **2.6 **bookings** (Iscrizioni / Presenze per Singola Lezione)**



* id: UUID (Primary Key)
* lesson_slot_id: UUID (Foreign Key -> lesson_slots.id)
* student_id: UUID (Foreign Key -> students.id)
* package_id: UUID (Foreign Key -> packages.id)
* attendance_status: ENUM (PENDING, PRESENT, ABSENT_PENDING_DECISION, ABSENT_DEDUCTED, ABSENT_FROZEN, RESCHEDULE_REQUESTED)
* reschedule_note: Text (Nullable — note inserite dal docente in caso di spostamento)
* updated_at: Timestamp


### **2.7 **audit_logs** (Tracciamento Attività)**



* id: UUID (Primary Key)
* actor_id: UUID (Foreign Key -> users.id)
* action_type: String (es. ATTENDANCE_VALIDATED, CREDIT_DEDUCTED, CREDIT_FROZEN, LESSON_UNLOCKED)
* entity_id: UUID
* metadata: JSONB (Dettagli stato precedente e nuovo)
* created_at: Timestamp


## 3. Regole di Business e Macchine a Stati


### **3.1 Gestione Conflitti e Capienza (Vincoli Hard)**



1. **Conflitto Sala:** Non possono esistere due record in lesson_slots con lo stesso room_id i cui intervalli [start_time, end_time) si intersecano.
2. **Conflitto Docente:** Non possono esistere due record in lesson_slots con lo stesso teacher_id i cui intervalli [start_time, end_time) si intersecano.
3. **Controllo Capienza:** Il sistema deve impedire l'inserimento di un nuovo record in bookings per un lesson_slot_id se il conteggio delle prenotazioni attive (attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')) è uguale a lesson_slots.max_capacity. L'interfaccia deve mostrare in tempo reale il contatore Posti occupati / Capienza massima (es. 6/8).


### **3.2 Flusso di Validazione Presenze e Scalabilità Crediti**

Il sistema non scala mai i crediti al momento della prenotazione, ma esclusivamente a valle della lezione secondo questa logica:



1. **Stato Iniziale:** La Titolare assegna lo studente alla lezione -> bookings.attendance_status = PENDING. \

2. **Azione Insegnante (Appello):** Durante o subito dopo la lezione, l'insegnante ha 3 opzioni per ogni studente: \

    * **Presente:** Imposta attendance_status = PRESENT. Il sistema decrementa immediatamente di 1 il credito residuo del pacchetto (packages.used_credits + 1).
    * **Assente:** Imposta attendance_status = ABSENT_PENDING_DECISION. Il credito non viene ancora toccato; il record entra nella coda di revisione della Titolare.
    * **Assenza con Spostamento:** Imposta attendance_status = RESCHEDULE_REQUESTED (con campo note opzionale per indicare l'imprevisto). Il credito resta congelato e il sistema notifica la Titolare affinché riprogrammi manualmente lo studente in una nuova data.
3. **Azione Discrezionale Titolare (Gestione Assenze):** Per ogni record in stato ABSENT_PENDING_DECISION, la Titolare visualizza un alert e sceglie con un clic:
    * **Opzione A (Scala lezione):** Passa lo stato a ABSENT_DEDUCTED -> incrementa packages.used_credits + 1.
    * **Opzione B (Congela lezione):** Passa lo stato a ABSENT_FROZEN -> incrementa packages.frozen_credits + 1 (la lezione resta disponibile nel pacchetto per essere riassegnata).
4. **Blocco e Sblocco Appello:** Quando l'insegnante conferma l'appello di tutti gli studenti della lezione, lesson_slots.is_validated diventa true e i pulsanti lato docente diventano di sola lettura. Solo la Titolare può cliccare su "Sblocca Appello" per consentire correzioni in caso di errore materiale.


### **3.3 Compensi Insegnanti \
**



* **Esclusione moduli economici:** Il sistema non gestisce tariffe orarie, cedolini o stati di pagamento verso le insegnanti.
* **Tracciamento operativo:** Il sistema calcola esclusivamente il monte ore lavorato (SUM(end_time - start_time) dei lesson_slots validati) per ciascuna insegnante a fini statistici e organizzativi.


## 4. Specifiche dei Moduli Funzionali


### **4.1 Modulo Calendario, Sale e "Ore Libere" (Titolare)**



* **Vista Calendario Multi-Risorsa:** Visualizzazione giornaliera e settimanale affiancata per **Sala 1** e **Sala 2**, con codice colore per insegnante.
* **Algoritmo Rilevamento Slot Liberi (Corsi Mirati):** Funzione di filtro "Mostra Disponibilità". Dato un intervallo temporale (es. fascia pomeridiana 14:00 - 18:00 nei giorni Lunedì-Venerdì), il sistema sottrae gli slot occupati e evidenzia visivamente i blocchi orari in cui almeno una sala e almeno un'insegnante risultano libere, permettendo alla Titolare di convertire lo slot libero in un nuovo corso specialistico con un clic.
* **Bacheca Disponibilità Pubblica (Opzionale / Senza Login):** Endpoint pubblico in sola lettura (URL condivisibile) che mostra esclusivamente gli slot dei nuovi corsi mirati e i posti residui (Capienza - Iscritti), con pulsante diretto per contattare la Titolare su WhatsApp.


### **4.2 Modulo Integrazione WhatsApp Zero-Cost (**wa.me**)**

Nessuna integrazione API a pagamento. Il sistema genera link dinamici formati secondo lo standard [https://wa.me/](https://wa.me/)&lt;telefono>?text=&lt;messaggio_url_encoded>:



1. **Promemoria Studente (1-Click):** Nella vista delle lezioni del giorno successivo, accanto a ogni studente compare l'icona/pulsante "Invia Promemoria". Al clic si apre WhatsApp con il testo precompilato:
2. *"Ciao [Nome], ti ricordiamo la tua lezione di [Titolo Corso] domani [Data] alle ore [Ora Inizio] presso [Nome Sala]. A presto!"*
3. **Promemoria Insegnante (1-Click):** Pulsante rapido nella scheda del docente per inviare il riepilogo turni o sollecitare un appello mancante.
4. **Broadcast Corsi Mirati:** Generatore di testo precompilato contenente l'elenco degli slot liberi/corsi speciali selezionati dalla Titolare, pronto per essere copiato o inoltrato alle liste broadcast su WhatsApp.


### **4.3 Modulo Appello Rapido e Notifiche (Insegnante)**



* **Vista Agenda Docente:** Mostra i corsi assegnati all'insegnante loggato, evidenziando chiaramente la sala assegnata per ogni turno, ma consentendo la consultazione del calendario completo di entrambe le sale per coordinamento logistico.
* **UX Appello (Regola dei 2 Tocchi):** Apertura della card lezione -> Lista studenti con nomi in grande e 3 pulsanti chiari per riga (Presente, Assente, Sposta). Un pulsante finale "Conferma e Chiudi Appello" storicizza i dati.
* **Sistema di Alerting Multi-Livello (Anti-Dimenticanza): \
**
    * **Badge Visivo In-App:** Banner rosso persistente nella home del profilo insegnante finché esistono lezioni passate con is_validated = false o studenti ancora in stato PENDING.
    * **Web Push Notifications (Service Worker):** Invio automatico tramite cron-job server-side di due notifiche push sul dispositivo del docente: 60 minuti prima dell'inizio della lezione (promemoria turno e sala) e 15 minuti dopo l'orario di fine lezione (promemoria validazione appello).
    * **Integrazione Google Calendar:** Sincronizzazione unidirezionale (tramite Google Calendar API o feed .ics dinamico) degli eventi assegnati all'insegnante con alert nativo configurato a -60 min e +15 min dalla fine.


### ** \
4.4 Dashboard di Monitoraggio e KPI (Titolare)**

La schermata principale della Titolare deve esporre in tempo reale:



1. **Stato Operativo Giornaliero:** Elenco lezioni odierne con indicatore semaforico dello stato appello (Verde = Validato, Giallo = In corso / Da validare entro 15 min, Rosso = Scaduto e non validato).
2. **Coda Azioni Richieste:**
    * Elenco assenze in attesa di decisione (ABSENT_PENDING_DECISION) con pulsanti rapidi [Scala] / [Congela].
    * Elenco richieste di spostamento (RESCHEDULE_REQUESTED) da riprogrammare.
3. **KPI Finanziari e Pacchetti:**
    * Elenco studenti con pagamenti in sospeso (UNPAID o PARTIAL) e saldo dovuto.
    * Elenco studenti con crediti residui 

<p id="gdcalert1" ><span style="color: red; font-weight: bold">>>>>>  gd2md-html alert: equation: use MathJax/LaTeX if your publishing platform supports it. </span><br>(<a href="#">Back to top</a>)(<a href="#gdcalert2">Next alert</a>)<br><span style="color: red; font-weight: bold">>>>>> </span></p>

 (alert rinnovo pacchetto).
4. **Analitica Frequenza Pacchetti:** Per ogni pacchetto (e aggregato globale), calcolo automatico del rapporto:
    * *Esempio Aggregato:* 100 lezioni vendute | 89 presenze | 11 assenze
    * *Esempio Dettaglio Studente:* 10 lezioni | 8 presenze | 2 assenze (1 scalata, 1 congelata)
5. **KPI Utilizzo Risorse (Settimanale / Mensile):**
    * Tasso di occupazione percentuale per singola sala e per fascia oraria (matrice giorni/ore per identificare i pomeriggi scarichi).
    * Monte ore lezioni svolte per ciascuna delle 2 insegnanti nel mese corrente.
6. **Audit Log:** Tabella filtrabile con timestamp esatto di quando ogni insegnante ha validato ciascuna lezione.


## 5. Requisiti Non Funzionali e Stack Consigliato



* **Architettura PWA:** Manifest configurato (display: standalone), Service Worker per caching degli asset statici e ricezione delle Web Push Notifications anche ad app chiusa (su Android e iOS 16.4+ previa aggiunta a schermata Home).
* **Real-Time Sync:** Utilizzo di database con sottoscrizioni WebSocket/Real-time (es. **Supabase / PostgreSQL** o **Firebase Firestore**) affinché l'aggiunta di uno studente da parte della Titolare aggiorni istantaneamente la lista appello sullo schermo dell'insegnante senza necessità di ricaricare la pagina.
* **Sicurezza (Row-Level Security):** Le policy di accesso ai dati devono essere applicate a livello di database (RLS), garantendo che il token di autenticazione di un ruolo STAFF non possa mai interrogare i campi economici della tabella packages nemmeno tramite chiamate API dirette.
* **Backup e Esportazione:** Funzione di esportazione CSV/Excel dei registri pacchetti, presenze e incassi per la contabilità fiscale esterna.