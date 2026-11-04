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

Phases to come: dismissal boards for teachers.

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
