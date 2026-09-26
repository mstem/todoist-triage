# todoist-triage

## Completed-task wiki at ~/Projects/bible.md (search it — NEVER load it)

`~/Projects/bible.md/` is an auto-maintained Open Knowledge Format wiki of every
completed Todoist task (10k+ entries, 350+ markdown files), one directory per
project mirroring the Todoist hierarchy, each with an `index.md` and a dated
`log.md`. Maintained by `backend/services/wikiSync.js` on a 15-minute timer.

Use it when Matt asks "when did I do X", "what happened in project Y", or needs
history from a specific project: `grep -ri` for keywords, or read the single
relevant `log.md`.

⚠️ **NEVER read this wiki into context wholesale — not at startup, not "for
orientation", not via broad Read/glob sweeps.** It is far larger than the
context window and loading it would destroy the session. Only ever grep it and
read the one or two specific files a query needs.
