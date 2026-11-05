# IICFE Study Hub

The student portal for IICFE Singapore: sign-in, **My Workspace** (courses, progress, payments, certificates, webinars, news) and
**The Founder's Lab** course (sessions with a video lecture, study notes, activities, a practice test and a one-try final exam).

- **Frontend:** plain HTML, CSS and JavaScript. No framework and no build step: the files in the repo are the files that are served.
- **Backend:** one small Express app (`server/`), deployed on Vercel as a single function (`api/index.js`).
- **Data:** a Google Sheet, read and written only by the server through a Google service account.
- **Videos:** Google Drive files, streamed by the server to signed-in, enrolled students. The browser never sees a Drive link or file id.

The browser only ever talks to our own `/api`. Only the server talks to Google.

## Folder structure

```
index.html, courses.html, signin.html,     the pages (404.html is served for any unknown address)
workspace.html, course.html, session.html, 404.html
css/          styles (tokens.css holds the colours for light and dark themes)
js/           page scripts: layout.js (header/footer, esc()), shell.js (app shell, api()), auth.js, workspace.js ...
js/hub/       the course hub and session page (Founder's Lab): player.js, notes.js, activities.js, tests.js ...
content/      Founder's Lab content shipped to the browser (session 1 notes, games, manifest). No answer keys, no ids.
server/       the API (never served as files)
  index.js            app, sign-in, security headers, rate limits, static pages
  course.js, lab.js   course routes and Founder's Lab routes (every route checks the session and enrolment)
  sessions.js         the session timeline (defaults + the LabSessions tab) and video links
  drive.js            streams a Drive video in HTTP ranges (seeking works; each answer stays under Vercel's 4.5 MB limit)
  sheets.js           the ONLY file that talks to Google Sheets (timeouts, one retry, a short cache for staff-edited tabs)
  schema.js           every tab and its header row
  security-headers.json  CSP and other headers (vercel.json repeats them; a test keeps the two identical)
  founders-lab-*.json answer keys and journey/session defaults (server-only)
  *.test.js           tests (in-memory fake Sheet; no Google needed)
api/index.js  Vercel's entry point (exports the Express app)
scripts/      one-off content tools
```

## Environment variables

Names only. Locally, copy `.env.example` to `.env`. On Vercel: Project Settings > Environment Variables.

| Name | Needed | What it is |
| --- | --- | --- |
| `SHEET_ID` | yes | The Google Sheet's id (from its URL, between `/d/` and `/edit`). |
| `SESSION_SECRET` | yes | 32+ random characters; signs the sign-in cookie. Changing it signs everyone out. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes on Vercel | The service account's JSON key, pasted whole. Locally you can instead save it as `server/credentials/service-account.json` (git-ignored). |
| `ANTHROPIC_API_KEY` | no | Turns on AI answers in the course chat; without it the chat uses keyword search. |
| `CHAT_MODEL` | no | Overrides the chat model. |
| `PORT` | no | Local port (default 3000). |
| `DEMO_PASSWORD` | only for `npm run seed` | Password for the demo rows the seed script creates. |
| `GOOGLE_KEY_FILE`, `SHEETS_CACHE_MS`, `SHEETS_TIMEOUT_MS`, `DRIVE_TIMEOUT_MS` | no | Advanced overrides (key file path, cache and timeout lengths). |

The service account needs **Google Sheets API** and **Google Drive API** enabled in its Google Cloud project.

## The Google Sheet

Row 1 of every tab is the header row; the full list of tabs and columns is in `server/schema.js` (`npm run check-db` verifies the live Sheet
against it). New columns are only ever added at the end. Values written by the app are stored as plain text (`RAW`), so text that starts with
`=` can never run as a formula.

- **Students** `studentId, name, email, password, status, joinedOn`. `status` must be `active` to sign in; setting it to anything else
  cuts access within about a minute. Passwords are plain text (founder decision): restrict who can open the Sheet.
- **Courses / Enrollments**: a course shows when its `status` is `live`; a student sees a course only with an Enrollments row for it.
- **Payments, Certificates, Webinars, News, Modules, ModuleProgress, Dues**: what My Workspace shows.
- **LabSessions**: the Founder's Lab session plan, one row per session (`sessionNo` = 1, 2, ...). A filled cell overrides the default in
  `server/founders-lab-sessions.json`; sessions after the first stay "Coming soon" until `visible` is `TRUE`.
- **LabProgress, LabExamAttempts, LabChecklist, LabSubmissions, LabProfiles, LabCompetitionEntries**: written by the app, one row per
  student and item (the key column is unique per student). Don't edit these by hand.

Staff-edited tabs are cached on the server for 60 seconds, so a Sheet edit shows within a minute. Student progress is never cached.

## Adding a session video

1. Upload the video (MP4, H.264) to Google Drive.
2. Share it **only** with the service account's email (Viewer). Turn off "Anyone with the link" — the server streams it to students itself.
3. In the **LabSessions** tab, in the row for that session (add one with its `sessionNo` if there isn't one), paste the Drive link into
   `videoUrl`. Optionally set `videoTitle`.

That's all: within a minute the session page plays the video. The page only ever gets `/api/courses/F001/lab/sessions/<no>/video/stream`,
which works only for a signed-in, enrolled student. YouTube and Vimeo links also work in `videoUrl` (embedded instead of streamed).
Sessions without a `videoUrl` show their illustrated placeholder.

Each video request returns at most 3 MB, so any length works within Vercel's limits; every full view passes the whole file through the
function once (bandwidth = file size × views).

## Run locally

```
npm install
cp .env.example .env          # then fill in SHEET_ID and SESSION_SECRET
# save the key as server/credentials/service-account.json (or set GOOGLE_SERVICE_ACCOUNT_JSON)
npm run check-db              # verifies the key, the sharing and every tab's headers
npm start                     # http://localhost:3000
npm test                      # all tests, against an in-memory fake Sheet (no Google needed)
```

`npm run setup-lab` creates any missing Founder's Lab tabs; `npm run seed` creates missing tabs and demo rows. Both are safe to run twice.

## Deploy

Push to `main`: Vercel builds and deploys automatically (there is no build step; `vercel.json` sends `/api/*` to the Express function,
serves everything else as static files, blocks the server and config files, adds the security headers and serves `404.html` for
unknown addresses). Set the environment variables above in Vercel first.

## Security notes

- Sign-in sets an 8-hour JWT in an HttpOnly, SameSite=Lax cookie (Secure on Vercel). Every data route checks it and that the student is
  still active and enrolled; the student is always taken from the cookie, never from the URL or body.
- The Final Exam unlock and the answer keys live on the server. Rate limits: sign-in per account and per address, API and writes per student.
- After changing an inline `<script>` or `onload` in a page, update its hash in `server/security-headers.json` and `vercel.json`
  (`npm test` fails until you do).
