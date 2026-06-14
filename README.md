# Todoist Triage

A swipe app for triaging your [Todoist](https://todoist.com). If you live out of "due: today" and watch it pile up, Triage gives you two fast review decks to clear the backlog one card at a time — swipe each card with keyboard, mouse, or touch.

- **Weekly Project Review** — swipe through every active project: **Keep**, move to **Backlog**, move to **Someday**, or **Archive**.
- **Do: Today Review** — swipe through every task due today: **Keep**, **Backlog**, **Someday**, or **Delete**.

Each card also has an optional **AI** button that drafts a next-step plan and posts it back to the project/task as a Todoist comment (it only proposes a plan — it doesn't do the work).

## How it works

- **Backend** — a small Node/Express server (`backend/`) that talks to the Todoist REST + Sync APIs using your personal API token.
- **Frontend** — a React/Vite single-page app (`frontend/`) built into `public/`, which the backend serves. So in normal use you run **one** process.

Swipe a card with the mouse/touch, click the action buttons, or use the **arrow keys** on desktop:

| Key | Project Review | Today Review |
| --- | -------------- | ------------ |
| ←   | Backlog        | Backlog      |
| →   | Keep           | Keep         |
| ↑   | Someday        | Someday      |
| ↓   | Archive        | Delete       |

## Setup

### 1. Get a Todoist API token

In Todoist: **Settings → Integrations → Developer → API token**. Copy it.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and paste your token:

```
TODOIST_API_TOKEN=your_token_here
PORT=3004
CLAUDE_BIN=claude
CLAUDE_PERMISSION_FLAGS=--allowedTools "Bash(curl:*)"
```

`CLAUDE_BIN` / `CLAUDE_PERMISSION_FLAGS` are only used by the optional AI button — see below.

### 3. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4. Build the frontend

```bash
cd frontend && npm run build
```

This compiles the app into `public/`, which the backend serves.

### 5. Run

```bash
cd backend && npm start
```

Open **http://localhost:3004** (or whatever `PORT` you set).

## Development

Run the backend and the Vite dev server (with hot reload) in two terminals:

```bash
cd backend && npm run dev      # http://localhost:3004 (API)
cd frontend && npm run dev     # Vite dev server with HMR
```

## Optional: the AI button

The AI button shells out to the [Claude Code](https://www.claude.com/product/claude-code) CLI (`claude -p`) to read the project/task and draft a next-step plan, then posts it back as a Todoist comment.

To use it you need the `claude` CLI installed and authenticated on the machine running the backend. Point `CLAUDE_BIN` at the binary if it isn't on your `PATH`. If you don't set this up, the rest of the app works fine — only the AI button is affected.

## Notes

- Your API token lives only in `.env`, which is gitignored. Never commit it.
- The app talks directly to **your** Todoist account — actions (archive, delete, move) are real. Try it on a throwaway project first if you want to see the behavior.
- The Project Review's **Back** button undoes the last swipe (un-archives, restores the original parent, etc.). The Today Review's Back is view-only.

## License

MIT — see [LICENSE](LICENSE).
