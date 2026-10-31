# IICFE Study Hub

Static frontend + a small Express API backed by a Google Sheet (demo: one course, one student).
The browser only ever talks to our own `/api`; only the server talks to Google.

## Setup

1. **Node 20.12+** and `npm install`.
2. **Service account key:** put the Google service-account JSON at
   `server/credentials/service-account.json`. It is git-ignored. Never paste it into frontend code or chat.
3. **Share the sheet** with the service account's `client_email` (open the sheet > Share > Editor).
4. **Enable the API:** "Google Sheets API" must be enabled in the key's Google Cloud project.
5. **`.env`** (git-ignored; copy `.env.example`): `SHEET_ID`, `SESSION_SECRET` (32+ random chars), `PORT` (default 3000).
6. `npm run setup-lab` (once): creates the Founder's Lab tabs `LabProgress` and `LabExamAttempts`. Tabs are never created during a page request.
7. `npm run seed` (needs `DEMO_PASSWORD` in `.env`): creates missing tabs/headers and demo rows. Safe to run twice.
8. `npm start`: site + API at http://localhost:3000

Demo access is available on request.

> **Student passwords are stored in plain text by founder decision. Anyone with access to the Google Sheet can read them. Restrict the sheet's sharing accordingly.**
> To change a password, edit the `password` cell in the Students tab. It applies on that student's next sign-in (no restart).

## Layout

- `index.html`, `courses.html`, `signin.html`, `workspace.html`, `css/`, `js/`: the frontend
  (`js/data.js` holds nav/footer/section labels; `js/main.js` holds home-page copy).
- `server/index.js`: Express app, auth (plain-text password compare, session as a JWT in an httpOnly, SameSite=Lax cookie), `/api` routes, static files (whitelisted).
- `server/sheets.js`: the **only** Google Sheets code (`readTab`, `readTabs`, `appendRow`, `updateRow`).
  Swap this file to move to a real database.
- `server/seed.js`: idempotent tab + demo-data seeding.
- `server/smoke.test.js`: `node server/smoke.test.js` runs the API against an in-memory fake sheet (no Google needed).

## API

`POST /api/login` · `POST /api/logout` · `GET /api/me` · `GET /api/courses` (public) · `GET /api/workspace` (login required, own rows only)

Founder's Lab (all need a login, the student always comes from the session): `GET/POST /api/courses/F001/lab/progress`, `GET/POST /api/courses/F001/lab/:session/practice`, `GET /api/courses/F001/lab/:session/exam`, `POST .../exam/start|save|submit`. The answer keys live in `server/founders-lab-tests.json` (server-only; never sent to the browser). `npm test` runs all three test files.

## Sheet tabs (row 1 = headers)

Students, Courses, Enrollments, Payments, Certificates, Webinars, News (plus LabProgress and LabExamAttempts for Founder's Lab). Edit rows in the sheet and refresh the workspace.
Enrollment `status` is `active` or `completed`. Course `status` must be `live` to show publicly.

## Troubleshooting

- `403 ... does not have permission`: the sheet isn't shared with the service account's `client_email`.
- `403 ... Sheets API has not been used`: enable the Google Sheets API for the key's project.
- `Quota exceeded`: Sheets allows ~60 reads/min per account; each workspace load is one read.
