# Professor IT self-hosted mode

Status as of 2026-08-23: deployed for browser use at
`https://professorit.ru/cards/` from branch `professorit/identity`.

## Purpose

Professor IT uses this application as a centralized interview preparation
trainer. The author maintains shared decks built from real interview questions.
Every LMS learner can study all shared decks while keeping an independent FSRS
schedule and progress history.

## Identity and data ownership

Professor IT LMS is the only identity provider. The cards backend uses an OAuth
authorization-code flow to obtain the verified email and display name. It does
not read the LMS database directly and does not share a database with Frappe.

The cards PostgreSQL database owns:

- shared card and deck content;
- each learner's workspace and repetition state;
- learner suggestions and their review status;
- applied shared-content revisions.

## Roles and content workflow

The Professor IT Administrator is the shared-content author. The author can
edit central decks and review learner suggestions in Settings.

Authenticated learners:

- automatically receive every central deck;
- cannot directly create, edit, or delete shared cards;
- keep private repetition scheduling and progress;
- may suggest a correction or extension to a shared answer.

A suggestion is never applied automatically. The author may edit its proposed
text and then accept or decline it. Reviewed suggestions leave the pending
queue so the page remains an actionable inbox rather than an archive.

The Professor IT web mode also hides AI chat, the automatic feedback prompt
and the mobile promotion dialog. Learner content suggestions remain available
through the dedicated shared-card workflow.

## Central decks

The repository contains reproducible source data and bootstrap scripts for the
Professor IT Linux and Git decks. The Git deck is published under catalog slug
`professor-it-git-foundation` and currently contains 50 Russian interview and
practice cards. Its source of truth is
`apps/backend/src/scripts/data/professorItGitDeck.ts`.

Publish the deck and install it into the author's workspace with an explicitly
scoped invocation:

```bash
cd apps/backend
PROFESSORIT_TARGET_USER_ID='frappe:author@example.com' \
  PROFESSORIT_TARGET_WORKSPACE_ID='workspace-uuid' \
  npx tsx src/scripts/bootstrapProfessorItGitDeck.ts
```

The command is idempotent for a published release: running it again neither
duplicates package cards nor installs a second author copy. Learners receive
all published Professor IT decks automatically on their next authenticated
request. Shared content remains centralized while scheduling and progress stay
inside each learner's workspace.

## Deployment topology

```text
Browser
-> https://professorit.ru/cards/
-> Traefik on 192.168.50.112 strips /cards
-> Nginx on CT 205, 192.168.50.115:80
   |-> web build
   `-> /v1/* -> backend on 127.0.0.1:8080
-> PostgreSQL in CT 205
```

Runtime source is mounted at `/opt/flashcards` in Proxmox container 205. The
container uses two CPU cores, 3 GB memory, 1 GB swap and a 20 GB disk.

## Configuration

Copy `infra/proxmox-lab/professorit-oauth.env.example` to a protected runtime
environment file and provide real values there. Never commit OAuth secrets,
session secrets or database credentials.

Important invariants:

- `AUTH_MODE=professorit`;
- the OAuth callback is `/cards/v1/auth/callback`;
- the session cookie path is `/cards`;
- the browser build uses `/cards/` as its base path;
- the LMS client redirects back only to the configured public callback.

Build the web application on the workstation:

```bash
scripts/deploy/build-professorit-web.sh
```

The script pins the public application, API and authentication paths and
disables the mobile promotion dialog.

## Database changes

Professor IT behavior is represented by normal repository migrations. Before
deployment, apply every migration newer than the currently deployed version.
Migrations `0114` through `0117` introduce centralized content, learner
suggestions, shared revisions and revision tracking. Do not edit these schemas
manually in production.

## Verification

After a release, test all of the following in separate browser sessions:

1. Administrator OAuth sign-in.
2. Learner OAuth sign-in.
3. Automatic access to every central deck.
4. Different progress for two learners studying the same card.
5. Direct shared-card editing denied for a learner.
6. Suggestion submission, author editing, acceptance and rejection.
7. Reviewed suggestions removed from the pending list.
8. Logout and session refresh below the `/cards` path.

Basic availability checks:

```bash
curl -fsS https://professorit.ru/cards/ >/dev/null
curl -fsS http://192.168.50.115/ >/dev/null
```

## Upstream update procedure

Keep Professor IT work in `professorit/identity`. Fetch the upstream default
branch, merge or rebase it in a separate integration step, resolve conflicts on
the workstation, then run the relevant checks and web build. Deploy only a
named committed revision. Never develop by editing `/opt/flashcards` as the
sole copy.

## Current hardening backlog

The present Proxmox deployment is still a lab-style runtime:

- the backend runs through `npm run dev`;
- PostgreSQL is published on all CT network interfaces;
- CT 205 does not start automatically with the Proxmox host;
- backup and restore automation is not yet documented;
- external availability monitoring is not yet connected.

Resolve these items before declaring the cards service production-hardened.
