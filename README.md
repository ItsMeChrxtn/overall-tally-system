# Overall Tally Management System

A multi-event platform for scoring and tabulating competitions. It handles pageants, dance, singing, sports, academic, talent and custom competitions. Organizers create events, define their own judging criteria, assign judges, register contestants and choose a scoring method, all without code changes. Official rankings come from a centralized backend scoring engine and go through a verification → approval → publication workflow. Every step is audit-logged.

**Stack:** React 18 + Vite + Tailwind CSS 4 + React Router + Axios + Recharts + Lucide + SweetAlert2 · Node.js + Express + MongoDB/Mongoose + JWT + bcrypt · jsPDF (PDF), ExcelJS (Excel), Socket.IO (live updates).

---

## Features by role

| Role | What they can do |
|---|---|
| **Super Admin** | System dashboard, all users and roles, every event (create/edit/archive/restore/delete), Event Admin assignment, global settings, audit logs, all reports |
| **Event Admin** | Their own and assigned events only: categories, contestants/teams, judge and tabulator accounts and assignments, dynamic criteria, scoring method, tie-break rules, lock/reopen scoring, monitoring, authorized score corrections, **encoding judges' paper score sheets** (Encode Scores tab, for name-only judges who do not sign in), generating results (tabulator capability), approve/return/publish/unpublish results, reports, event audit trail |
| **Tabulator** | Assigned events: live tally, judge submission monitoring, score breakdowns, tie detection, generate versioned result tallies, submit for approval, PDF/Excel exports. Cannot edit criteria or scores. |
| **Judge** | Assigned categories only: contestant profiles, criteria and instructions, score entry with range/precision validation, drafts, review-and-submit (locked after submission), submission history. Never sees other judges' scores. |
| **Public** | Published events and official, approved rankings only |

### Core rules enforced by the backend
- Criteria are never hardcoded. Each category has its own criteria (weight, min/max, decimal precision, order, active flag).
- Weighted methods require weights totalling exactly 100%. Negative weights and invalid ranges are rejected.
- **Locking:** opening scoring validates the setup and writes an immutable, versioned configuration snapshot. After that, criteria, weights, method, tie rules, the judge panel and contestants are frozen unless the configuration is formally reopened with a reason, which reopens all submitted sheets.
- Submitted sheets are locked. Corrections go through an Event Admin "reopen for correction" with a documented reason. The judge then resubmits, and the full history is kept.
- Official rankings are never computed from incomplete sheets unless the event explicitly allows it.
- Ties are never broken by arbitrary order. Configured rules are applied in order, and anything still tied shares the rank (1, 2, 2, 4). Every decision is recorded on the result.
- Results are versioned. Submit, approve and publish all re-verify the stored tally against the live data (hash check). If scores changed, the version is rejected as stale.
- Totals, ranks and roles from the client are never trusted. The frontend only shows previews.
- Audit logs are append-only: update and delete are blocked at the model level.

### Scoring methods
| Method | Calculation |
|---|---|
| Weighted | judge score = Σ (score ÷ max × weight); final = average over judges |
| Average | judge total = Σ criteria; final = average of judge totals |
| Total | final = Σ of all judges' criterion scores |
| Rank-based | judges rank contestants 1..N; lowest rank sum wins |
| Custom: Trimmed Mean | weighted, dropping the highest and lowest judge when there are 3+ judges |
| Custom: Rank of Scores | each judge's weighted scores become ranks (fractional on ties); lowest sum wins |
| Overall tally (event) | combines categories by weighted normalized score or by rank sum |

New strategies plug into `CUSTOM_STRATEGY_REGISTRY` in `server/src/services/scoringEngine.js`.

---

## Project structure

```
overall-tally-system/
├─ server/                 Express API
│  ├─ src/
│  │  ├─ config/           env + MongoDB connection
│  │  ├─ constants/        roles, statuses, methods
│  │  ├─ controllers/      route handlers (auth, users, events, categories, criteria, contestants,
│  │  │                    assignments, judging, sheets, tally, reports, public, dashboard, misc)
│  │  ├─ middleware/       JWT auth + role guard, error handler, image uploads
│  │  ├─ models/           Mongoose schemas (see below)
│  │  ├─ routes/           REST routes
│  │  ├─ services/         scoringEngine (pure), tabulationService, accessService (event-level RBAC),
│  │  │                    reportService (+ Excel), auditService, notificationService, realtime (Socket.IO)
│  │  ├─ scripts/          seed.js, createAdmin.js
│  │  ├─ app.js · server.js
│  ├─ tests/               scoring engine unit tests (node:test)
├─ client/                 React app (Vite)
│  └─ src/
│     ├─ api/ auth/ lib/   axios client, auth context + protected routes, formatting, alerts, socket, report export
│     ├─ components/       design system (ui/), layouts, status badges, activity feed, audit table
│     └─ pages/            public, auth, dashboard, events (workspace tabs), judging, users, audit, settings, profile
└─ docs/API.md             endpoint reference
```

### Database collections
`users`, `events`, `categories`, `contestants`, `eventassignments` (event-level roles; judges also carry their categories and seat order), `judgingcriteria`, `scoringconfigurations` (versioned snapshots), `scoresheets` (one per judge × contestant × category, with the scores embedded so each save is atomic, plus a history log), `tabulationresults` (versioned official tallies), `resultapprovals`, `auditlogs`, `notifications`, `settings`.

Judges are regular `users` with role `judge`. Their profile (title, affiliation) lives on the user, and their event participation lives in `eventassignments`.

---

## Local development

### Requirements
- Node.js 18.18+ (tested on 22)
- MongoDB 6+ running locally, or a MongoDB Atlas connection string

### 1. Install
```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```
Edit `server/.env`: set `MONGO_URI` and a long random `JWT_SECRET`. SMTP is optional. Without it, password-reset links are printed to the server console.

### 3. Seed demo data (development only; this wipes the configured database)
```bash
cd server && npm run seed
```
The seed creates realistic data through the real services:
- **Mr. & Ms. University 2026**: published results, including a tie resolved by the highest-weight criterion, plus a preliminary "Best in Talent" version.
- **Inter-College Dance Showdown 2026**: mid-scoring, with drafts, missing sheets, a trimmed-mean category and an overall tally.
- **Battle of the Voices 2026**: still in setup, with a weighted category and a rank-based category.
- An event owned by a second Event Admin, to show event isolation.

Demo accounts (development only). Every account uses the password `Tally@2026`:

| Role | Email |
|---|---|
| Super Admin | superadmin@tally.test |
| Event Admin | admin@tally.test |
| Event Admin (other event) | admin2@tally.test |
| Tabulator | tabulator@tally.test, tabulator2@tally.test |
| Judge | judge1@tally.test … judge5@tally.test |

To create a real administrator without wiping data:
```bash
cd server && npm run create-admin -- --name "Jane Admin" --email jane@example.com --password "Str0ngPassw0rd"
```

### 4. Run
```bash
cd server && npm run dev
```
```bash
cd client && npm run dev
```
Open http://localhost:5180. The Vite dev server proxies `/api`, `/uploads` and Socket.IO to port 5050.

### 5. Tests
```bash
cd server && npm test
```
The tests cover every scoring method, rounding, tie-breaking (criterion, judge, shared ranks), missing/draft/incomplete detection and the overall tally.

---

## Deployment

**Database:** create a MongoDB Atlas cluster and copy its connection string into `MONGO_URI`.

**API (Render / Railway / any Node host):**
- Root directory `server`, build `npm install`, start `npm start`.
- Environment: `NODE_ENV=production`, `MONGO_URI`, `JWT_SECRET` (32+ characters), `JWT_EXPIRES_IN`, `CLIENT_URL=https://your-frontend.example.com`, optional SMTP settings.
- Uploaded images go to `server/uploads`. Attach a persistent disk, or move uploads to object storage, for multi-instance hosting.
- Run `npm run create-admin -- …` once for the first Super Admin. Do **not** run the seed in production; the script refuses to run when `NODE_ENV=production`.

**Frontend (Vercel / Netlify / static hosting):**
- Root directory `client`, build `npm run build`, output `dist`.
- Environment: `VITE_API_URL=https://your-api.example.com/api`, `VITE_SERVER_URL=https://your-api.example.com`.
- Add an SPA rewrite so every route serves `index.html` (on Vercel: `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`).

**Security checklist:** HTTPS everywhere, a strong `JWT_SECRET`, `CLIENT_URL` limited to your domain, MongoDB network access restricted, regular database backups (audit logs and results are the official record).

---

## Typical workflow

1. **Setup:** create the event, then add categories, contestants or teams, and judge/tabulator accounts. Assign the judges to categories.
2. **Configure:** for each category, add criteria and weights, choose the method and decimal places, order the tie-break rules, then **Lock & open scoring**.
3. **Judge:** judges score each contestant, save drafts, review and submit. Sheets lock on submit.
4. **Tabulate:** the tabulator watches the live matrix, checks the tally, ties and missing sheets, generates a result version and submits it for approval.
5. **Approve:** the Event Admin reviews, then approves or returns it with a reason. For a correction, reopen the specific sheet, have the judge resubmit, then generate a new version.
6. **Publish:** publish to the public page, export the PDF/Excel reports with prepared/verified/approved signatures, mark the event completed, then archive it.

See [docs/API.md](docs/API.md) for every endpoint.
