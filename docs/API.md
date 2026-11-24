# API Reference

Base URL: `http://localhost:5050/api` (development).
All responses are JSON: `{ "success": true, ... }` on success and `{ "success": false, "message": "...", "code": "..." }` on error.
Authenticated routes need `Authorization: Bearer <JWT>`.

Roles: `super_admin`, `event_admin`, `tabulator`, `judge`. On top of the role check, every event-scoped route goes through **event-level access control**: Event Admins, Tabulators and Judges can only reach events they are assigned to.

| Capability | Who |
|---|---|
| manage | Super Admin, Event Admin assigned to (or creator of) the event |
| tabulate | Super Admin, Tabulator assigned to the event |
| review | manage **or** tabulate |
| approve | manage |
| judge | Judge assigned to the event (and to the specific category) |

## Public (no account)

| Method | Path | Description |
|---|---|---|
| GET | `/public/settings` | System name / organization |
| GET | `/public/events` | Events with at least one **published** result |
| GET | `/public/events/:id` | Event info + published results only (scores hidden if the event disables them) |

## Authentication

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | Returns `{ token, user }`. Rate limited. |
| GET | `/auth/me` | — | Current user |
| POST | `/auth/logout` | — | Audit-logged |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }` | Returns a new token; revokes other sessions |
| POST | `/auth/forgot-password` | `{ email }` | Emails a 30-minute reset link (console in dev) |
| POST | `/auth/reset-password/:token` | `{ password }` | |
| PATCH | `/auth/profile` | `{ name?, title?, affiliation?, phone? }` | |

Users flagged `mustChangePassword` receive `403 PASSWORD_CHANGE_REQUIRED` on every other route until they change it.

## Dashboard & notifications

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard` | Role-specific statistics |
| GET | `/notifications` | Latest 50 + unread count |
| PATCH | `/notifications/:id/read` · `/notifications/read-all` | |

## Users (Super Admin: all roles · Event Admin: judges & tabulators only)

| Method | Path | Body |
|---|---|---|
| GET | `/users?role=&status=&q=&page=&limit=` | |
| POST | `/users` | `{ name, email, role, password, title?, affiliation?, phone?, mustChangePassword? }` |
| GET | `/users/:id` | user + assignments |
| PATCH | `/users/:id` | profile / role fields |
| PATCH | `/users/:id/status` | `{ status: "active" \| "inactive" }` (deactivation revokes sessions) |
| POST | `/users/:id/reset-password` | `{ password }` sets a temporary password |

## Settings & audit

| Method | Path | Who |
|---|---|---|
| GET / PUT | `/settings` | Super Admin |
| GET | `/audit-logs?event=&action=&entityType=&user=&q=&from=&to=&page=` | Super Admin (all) · Event Admin (own events). There is **no** update/delete endpoint; the model blocks it. |

## Events

| Method | Path | Capability | Body / notes |
|---|---|---|---|
| GET | `/events?status=&type=&q=` | staff | Only accessible events. `status=all` includes archived. |
| POST | `/events` | admins | `{ name, eventType, venue?, organizer?, eventDate?, startDate?, endDate?, description?, status?, settings?, overall?, adminIds? }` |
| GET | `/events/:id` | review / judge | event + `can` capabilities + counts |
| PATCH | `/events/:id` | manage | any of the create fields; `adminIds` Super Admin only |
| PATCH | `/events/:id/status` | manage | `{ status }` (`published`/`completed` require a published result) |
| POST | `/events/:id/archive` | manage | archived events are read-only |
| POST | `/events/:id/restore` | Super Admin | |
| DELETE | `/events/:id` | Super Admin | refused if any score was submitted or any result exists |
| POST | `/events/:id/cover` | manage | multipart `image` |

`settings`: `allowMultiCategoryContestants`, `judgesCanViewOwnSubmitted`, `allowIncompleteRanking`, `publicShowScores`.
`overall`: `{ enabled, title, method: "weighted" | "rank_sum", decimalPlaces }`.

### Staff assignments

| Method | Path | Body |
|---|---|---|
| GET | `/events/:eventId/assignments` | includes judge progress |
| POST | `/events/:eventId/assignments` | `{ user, role, categories?, order? }` — account role must match |
| PATCH | `/assignments/:id` | `{ categories?, order? }` |
| DELETE | `/assignments/:id` | refused for judges with submitted sheets |

Judge panel changes are refused for categories whose configuration is locked.

## Categories & scoring configuration

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/events/:eventId/categories` | review | with stats & latest result status |
| POST | `/events/:eventId/categories` | manage | `{ name, description?, instructions?, scoringMethod, customStrategy?, decimalPlaces?, tieBreakRules?, includeInOverall?, overallWeight? }` |
| GET | `/categories/:id` | review | category, criteria, judges, contestants, config versions, results, config check |
| PATCH | `/categories/:id` | manage | scoring fields refused while locked |
| DELETE | `/categories/:id` | manage | refused once scores/results exist |
| PUT | `/categories/:id/contestants` | manage | `{ contestantIds }` |
| PUT | `/categories/:id/judges` | manage | `{ judgeIds }` |
| GET | `/categories/:id/config-check` | review | `{ ok, errors, warnings }` |
| POST | `/categories/:id/lock` | manage | validates, writes a versioned `ScoringConfiguration` snapshot, opens scoring |
| POST | `/categories/:id/reopen-config` | manage | `{ reason }` — reopens all submitted sheets, audit-logged |
| POST | `/categories/:id/close-scoring` · `/reopen-scoring` | manage | |
| POST | `/categories/:id/copy-criteria` | manage | `{ fromCategory }` |

`scoringMethod`: `weighted` · `average` · `total` · `rank` · `custom` (`customStrategy`: `trimmed_mean` · `rank_of_scores`).
`tieBreakRules` (ordered): `{ type: "highest_weight_criterion" }`, `{ type: "criterion", criterion }`, `{ type: "judge", judge }`, `{ type: "shared" }`.

### Criteria

| Method | Path | Body |
|---|---|---|
| GET | `/categories/:categoryId/criteria` | |
| POST | `/categories/:categoryId/criteria` | `{ name, weight, minScore, maxScore, decimalPlaces, description?, isActive? }` |
| PATCH | `/criteria/:id` | partial |
| DELETE | `/criteria/:id` | disabled instead of deleted if historical scores reference it |
| PUT | `/categories/:categoryId/criteria/reorder` | `{ ids: [...] }` |

Validation: no negative weights or scores, `maxScore > minScore`, and for weighted/custom methods the active weights may not exceed 100% (and must equal 100% to lock).

## Contestants

| Method | Path | Body |
|---|---|---|
| GET | `/events/:eventId/contestants` | |
| POST | `/events/:eventId/contestants` | `{ number, name, isTeam?, teamName?, members?, representing?, description?, status?, categories? }` |
| PATCH | `/contestants/:id` | partial |
| DELETE | `/contestants/:id` | refused if scores were submitted (use `status: "withdrawn"`) |
| POST | `/contestants/:id/photo` | multipart `image` |

## Judge portal (role `judge`)

| Method | Path | Body |
|---|---|---|
| GET | `/judging/assignments` | assigned events & categories with progress |
| GET | `/judging/categories/:id` | locked criteria, contestants and **own** sheets only |
| PUT | `/judging/categories/:id/sheets/:contestantId` | `{ scores: [{ criterion, value }] }` or `{ rank }` — save draft |
| POST | `/judging/categories/:id/sheets/:contestantId/submit` | optional body as above — submit & lock |
| POST | `/judging/categories/:id/submit-all` | `{ sheets?: [{ contestant, scores?, rank? }] }` — all-or-nothing; required for rank-based categories |
| GET | `/judging/history` | own submitted sheets (scores hidden if the event disallows it) |

Server-side checks: score range, decimal precision, every criterion scored before submitting, unique ranks 1..N, scoring open, judge belongs to the locked panel, and no duplicate submissions.

## Score sheets (staff)

| Method | Path | Capability |
|---|---|---|
| GET | `/categories/:id/sheets` | review |
| GET | `/categories/:id/progress` | review: judge × contestant matrix |
| GET | `/sheets/:id` | review: includes history |
| POST | `/sheets/:id/reopen` | manage: `{ reason }`, the authorized correction workflow. Refused while a result is for approval, approved or published. |

## Tabulation & approval

| Method | Path | Capability |
|---|---|---|
| GET | `/categories/:id/tally` | review: live computation, not saved |
| GET | `/categories/:id/results` | review: saved versions |
| POST | `/categories/:id/results` | tabulate: save a new preliminary version |
| GET | `/events/:eventId/overall` | review: live overall tally |
| POST | `/events/:eventId/overall/results` | tabulate |
| GET | `/events/:eventId/results` | review |
| GET | `/results/:id` | review: result + approval history |
| POST | `/results/:id/submit` | tabulate: `{ note? }`, needs complete sheets unless the event allows otherwise |
| POST | `/results/:id/approve` | approve |
| POST | `/results/:id/return` | approve: `{ note }` (required) |
| POST | `/results/:id/publish` | approve |
| POST | `/results/:id/unpublish` | approve: `{ note }` (required) |

On submit, approve and publish, the backend **recomputes** the tally and compares a hash of the score data. If anything changed since generation, it rejects with `409 RESULT_STALE`.

Status flow: `preliminary → for_approval → approved → published` (with `returned`, `superseded`, and `unpublished → approved`).

## Reports

| Method | Path | Notes |
|---|---|---|
| GET | `/reports/types` | |
| GET | `/reports/:eventId/:type?category=&judge=&contestant=&result=&from=&to=&format=json\|xlsx` | `json` returns the report structure (rendered to PDF/HTML by the client); `xlsx` streams an Excel file |

Types: `tally`, `judge_sheet`, `contestant_breakdown`, `category_ranking`, `final_results`, `judge_submission`, `event_summary`, `audit_trail` (manage only).

## Real-time (Socket.IO)

Connect with `auth: { token }`. Emit `event:join <eventId>` (access-checked) to receive:
`sheet:submitted`, `sheet:reopened`, `category:updated`, `result:updated`, `assignments:updated`, `contestants:updated`.
Every user also receives `notification` events in a private room.
