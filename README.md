# Cornerstone Parent Portal

Parent and front office web app for Cornerstone Christian School — **https://portal.csjax.org**. Separate from app.csjax.org (the family info app and dismissal boards), but it uses the same Supabase project.

- **Parents:** https://portal.csjax.org — sign in with the cell phone or email on file (one-time code; the device is remembered for a year).
- **Front office:** https://portal.csjax.org/office — staff sign in with email + password.
- **Vercel project:** `cornerstone-portal` (pushing to `main` deploys).
- **Database:** Supabase project `cornerstone-school-app` (ref `cvvdwhgdiqnoqgxtgzfw`), tables `portal_*`.

## Phase 1 (live)
| Feature | Rules |
|---|---|
| Parent excused note | Same fields as the DocuWare "Excused Absent Note" form (reason list, parent name/phone, signature). One note per day absent. Must be within 5 school days of the absence. A student can have at most **5 approved parent notes per semester**; the 6th is blocked and the parent is told a doctor's note is needed. |
| Doctor's note | Photo or PDF upload (up to 6 files, photos are resized on the phone). No limit. |
| Office review | Approve / reject with an optional note the parent sees in History. Approving a 6th parent note in a semester is blocked. |
| Dismissal change | Like KidAccount: today / another day / date range / permanent, afternoon or morning. Shows the student's current transportation and every pickup person in the data file. **Same-day changes close at 1:00 PM ET.** Every change emails all active front office staff. |
| Change report | /office → Dismissal changes: filter by submitted date or dates in effect, status, search; mark processed once KidAccount is updated; download CSV. |

## Phase 2 (live): early check-out & late sign-in
- **Pick-up PINs:** every parent/guardian and pickup person in the roster gets a unique 4-digit PIN (`portal_people`), keyed by phone (or email, or name when neither exists). The same person keeps the same PIN for all their students and across daily imports. Parents see the PINs on their home screen; the office sees PINs next to names on Students, Dismissal changes and Sign-In/Sign-Out.
- **iPad kiosk — portal.csjax.org/kiosk:** a staff member signs in once on the iPad to turn it on (device key in `portal_kiosks`; turn off in Settings). Hold the logo 3 seconds to reset the iPad.
  - Early check-out: PIN → students linked to that person → reason → signature.
  - Late sign-in: adult with PIN (same as above), or a student by badge barcode (camera), typed student ID, or name search → reason.
  - 5 wrong PINs lock the iPad for 3 minutes. A student can be checked out / signed in late once per day.
- **Office → Sign-In/Sign-Out:** today's list (refreshes every 30 s), signatures, "Updated in FACTS" checkbox per entry (records who and when), CSV.

## Phase 3 (live)
- **Install & alerts:** after sign-in, phones get a prompt to add the portal to the home screen (iOS steps / Android install button), then to turn on alerts. Subscriptions in `portal_push_subs`; office sends from Home → *Send a parent alert* (all, grade, homeroom, one family) through the Supabase Edge Function `portal-push` (same VAPID keys as app.csjax.org). Parents are also alerted when a note is approved or not approved.
- **Pick-up people:** parents/guardians add or remove pick-up people (Home → Pick-up people). Changes take effect right away (`portal_pickup_requests` overlaid on the FACTS list via view `portal_pickups_eff`), new people get a PIN immediately, and the office is emailed. When the FACTS import later includes/drops the person, the request is marked resolved and the PIN carries over to the FACTS Reference ID.
- **Reference ID linking:** people are keyed by the FACTS Reference ID (`r:<id>`), and parents/guardians take the Reference ID of their matching contact row. Anyone with a phone/email in the file can sign in and sees every student they're linked to. Excused notes and pick-up list changes are limited to parents/guardians (FirstName LastName / … 1 columns); pick-up contacts can view students, see PINs and submit dismissal changes.
- **Office Home:** Change requests (dismissal, pick-up person, other), Late sign-in & early sign-out (print 4"×2½" tardy / early-dismissal slip), Excused attendance notes (doctor's note download or generated PDF with student name, ID, date, reason, signature), Enter a change, Send a parent alert. Every item has an **Entered in FACTS** checkbox; "Needs entering in FACTS" is the default view.

## Phase 4 (live): classroom dismissal boards
- **Boards:** `https://portal.csjax.org/dismissal/<teacher>` (e.g. `/dismissal/charles-brand`), list at `/dismissal`. Same look and link names as app.csjax.org, including the combined `williams-newkirk` board and `nichelle-wilson` link (`COMBINED` / `RENAME` in `api/dismissal.js`).
- **Data (live, refreshes every minute):** today's afternoon transportation from the roster file, overridden by any parent/office dismissal change in effect today (marked **Changed**), minus students checked out early on the front office iPad (listed at the bottom). Database: `portal_board_read` / `private.portal_dismissal_today`.
- **Campus only:** `/api/dismissal` answers only IPs in Vercel env `DISMISSAL_ALLOWED_IPS` (107.1.157.26, 71.199.80.116).
- **Classroom page:** `/classroom` — teacher picks a class (remembered), bottom bar with Change class / Close board.
- **Chrome extension:** `chrome-extension/` — "Cornerstone Portal Dismissal Board". Opens `/classroom` full-screen 2:35–3:30 PM Mon–Fri, remembers the class with Chrome sync, Close board keeps it closed for the day, toolbar icon opens it any time. Privacy policy: `/privacy-extension`. Store listing and Admin steps: `chrome-extension/STORE-LISTING.md`.

## Daily roster file
The student/parent export (same columns as "Report 1.csv") feeds everything:
- `FirstName LastName` / `Cell phone` / `Email` and the `… 1` columns = the two parents/guardians who can sign in.
- `First Name` / `Last Name` / `Relationship` / `Cell phone 2` = pickup people.
- Transportation columns = what parents see as "now on file".

**Normal way — SFTP (Oracle Cloud server 141.148.36.44):**
- The school (for now) or the vendor (later) uploads the CSV to `/uploads` with the `ccsftp` login (password).
- Supabase `pg_cron` job `portal-sftp-import` calls `POST /api/sftp-import` every 30 minutes, 5 AM–6:30 PM ET, Mon–Fri.
- The portal signs in as `ccsportal` (key only, env `SFTP_PRIVATE_KEY`), imports the newest CSV, and moves it (plus any older ones, marked `skipped_`) to `/processed` with a date stamp.
- If the safety stop trips or the file is wrong, the file stays in `/uploads`, the office is emailed once, and the error shows on /office → Roster upload. Fix the file, or tick "I'm sure" and click **Check SFTP now**.
- Car Line and Car Rider mean the same thing; parents see "Car Rider".

Backup ways: /office → Roster upload (choose the file), or:
```
curl -X POST https://portal.csjax.org/api/roster-import \
  -H "x-import-key: $ROSTER_IMPORT_KEY" --data-binary @"Report 1.csv"
```
An upload that would turn off more than 15% of students is refused unless forced (`?force=1` or the checkbox).

## Environment variables (Vercel)
| Key | What |
|---|---|
| `PORTAL_API_KEY` | Matches `private.config.portal_api_key`; lets the API call the parent database functions |
| `SESSION_SECRET` | Signs parent sign-in cookies |
| `ROSTER_IMPORT_KEY` | Sent by the pg_cron job (copy in `private.config.portal_import_key`) and the backup upload API |
| `SFTP_PRIVATE_KEY` | Private key for the `ccsportal` SFTP login (from Oracle Cloud Shell `portal_key`). Optional: `SFTP_HOST`, `SFTP_USER`, `SFTP_UPLOAD_DIR`, `SFTP_PROCESSED_DIR` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID` | Text sign-in codes (Twilio Verify) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email sign-in codes and office alerts (csjax.org verified in Resend) |

## Settings the office can change (/office → Settings)
Front office staff list (each also needs a Supabase sign-in: Authentication → Users → Add user), semester dates, notes per semester, note deadline, same-day cutoff.

## Files
- `kiosk.html`, `kiosk.js` — front office iPad sign-in/sign-out
- `index.html`, `app.js` — parent app · `office.html`, `office.js` — staff portal · `theme.css` — shared look (matches app.csjax.org)
- `api/sftp-import.js` — daily pull from the SFTP server
- `api/auth.js` — code sign-in · `api/parent.js` — notes, files, dismissal changes, office email · `api/roster-import.js` — automated upload
- `supabase/migrations/` — staff database functions (parent functions and tables are in the Supabase migration history: `portal_phase1_tables`, `portal_phase1_functions`, `portal_staff_functions`)
- Icons are served from app.csjax.org (see `vercel.json` rewrites).

## Daily files (Nov 2026 layout)
**Student & parent file** (`Report_5.csv` layout) — adds:
- `7th Period Dismissal Teacher`: when filled, the student is on that teacher's dismissal board; blank = homeroom board. Name variants are folded with `portal_teacher_alias` (e.g. `nichelle-wilson` → `nichelle-english-wilson`).
- `Parent Individual ID` / `Parent Individual ID 1`: the parent's FACTS ID (same numbers as pick-up `Reference ID`). Parents and pick-up people are one person per ID (`r:<id>`); one login sees every student linked to that ID. Two IDs with the same name and same PIN are treated as one person.
- `Pin` / `Pin 1`: that parent's kiosk PIN. File PINs always win; a random PIN that collides is replaced. If the file gives the same PIN to two different people, the first keeps it and the import warns (Roster upload / PIN report).

**Daily attendance file** (`studentid`, `Attendance` = P/A), sent ~11:30 AM. Stored in `portal_attendance` for today. Today's status (`private.portal_status_today`):
- checked out early on the iPad → **dismissed** (off the board, listed "Checked out early")
- signed in late → **late** = present (on the board, even if the file said A)
- A in the file → **absent** (off the board, listed "Absent today")
- otherwise → **present** (also before the file arrives)

SFTP: the import detects each file by its columns, imports the newest roster and the newest attendance file, and moves everything to /processed. The pg_cron job now runs every 15 minutes on school days.

**Office:** new *Pick-up & PIN report* tab (every parent/guardian and pick-up person per student with PIN, FACTS ID, where the PIN came from; search, grade/teacher filter, print, CSV). Home shows today's present/late/absent/checked-out counts; Students search shows today's status and dismissal board.

## Phase 6: buses, car line, roles, archive (Nov 2026)
- **Import schedule** (`private.portal_sftp_tick`, pg_cron every 5 min): on school days it calls `/api/sftp-import` only in the windows 10:00–10:30 AM and 5:00–5:30 PM (student & parent file) and 11:30 AM–12:00 PM (daily attendance), New York time (handles daylight saving).
- **Roles** (`portal_staff.role`): `office` (office portal), `carline` (`/carline` only), `bus` (`/bus` only). Office creates sign-ins in Settings → Staff sign-ins (Edge Function `portal-staff-users`).
- **Bus drivers — `/bus`:** pick a bus (remembered), see today's riders by stop with present/absent, tap when a student boards.
- **Car line — `/carline`:** today's car riders; tap a student, pick the authorized pick-up person; saved in `portal_dismissals`.
- **Today's plan** (`private.portal_plan_today`): roster transportation + today's dismissal changes + attendance + early check-outs. Used by bus rosters, car line, alerts and boards.
- **Boards:** students marked on a bus / picked up show greyed with ✓ ("On bus 5 · 3:12", "Picked up by …"); column headers show how many are left. Boards refresh every 30 s from 2:35–3:30 PM, otherwise every minute.
- **Office:** Home shows only items to approve/enter in FACTS. Students = A–Z list (current or archived) → student page with today's plan, people & PINs, full history, and *Enter a change*. Buses & car line = attendance today, dismissal progress, printable bus rosters (one page per bus, by stop, present/absent). Alerts can target today's transportation (car riders, Bus 1/4/5, after care…).
- **Archive:** students missing from the file are archived (`archived_at`) with all history kept; they return automatically if they reappear.
