# Workflow overview — rationale

Rationale behind `prompts/collaboration-workflow/overview.md`.

## Why the session language defaults the way it does

- Dialogue defaults to `ja` when `JOSH_SESSION_LANG` is unset, empty or has no `.env`: a one-word
  prompt gives no language to detect, and the session drifts toward the surrounding English.
- Issue and PR titles stay English to keep the Issue list scannable and the branch names
  `pnpm josh git` derives from them ASCII.
- Code comments, test titles and commit messages follow the repository's code conventions, an axis
  separate from a developer's personal language.
- A script's standard output and fixed Telegram labels are not text the agent writes, so they stay
  English. A comment a script posts is read by the developer, so its prose follows
  `JOSH_SESSION_LANG` through `session_language` (`scripts/josh/session-language.ts`); only the
  headings, markers, ledger lines and decision phrases other code matches stay English.
- `JOSH_SESSION_LANG` is a personal setting, so it lives in the gitignored `.env`; it differs per
  consumer and per developer, and `josh sync` never overwrites it.
- The `UserPromptSubmit` hook injects the value once per turn whenever the variable is set — an
  explicit `ja` included — so the agent never has to read `.env`; it prints nothing only when the
  variable is unset, empty or has no `.env`, because the resident `CLAUDE.md` line already names the
  `ja` default (joshuafolkken/kit#3398). It was removed from `SessionStart` because the first turn
  resolved it twice. Scripts read the variable only to choose the language of prose they write;
  `session:lang` displays it.
