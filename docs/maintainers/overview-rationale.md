# Workflow overview — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/overview.md`. It is never read
during a run, and a change to this file changes no rule. The reasons below used to sit inside the rule
text; they moved here in joshuafolkken/kit#3179.

## Why the session language defaults the way it does

- Dialogue defaults to `ja` when `JOSH_SESSION_LANG` is unset, empty or has no `.env`: a one-word
  prompt gives no language to detect, and the session drifts toward the surrounding English.
- Issue and PR titles stay English to keep the Issue list scannable and the branch names
  `pnpm josh git` derives from them ASCII.
- Code comments, test titles and commit messages follow the repository's code conventions, an axis
  separate from a developer's personal language.
- Script-emitted strings are not text the agent writes and have no translation mechanism.
- `JOSH_SESSION_LANG` is a personal setting, so it lives in the gitignored `.env`; it differs per
  consumer and per developer, and `josh sync` never overwrites it.
- The `UserPromptSubmit` hook injects the value once per turn whenever the variable is set — an
  explicit `ja` included — so the agent never has to read `.env`; it prints nothing only when the
  variable is unset, empty or has no `.env`, because the resident `CLAUDE.md` line already names the
  `ja` default (joshuafolkken/kit#3398). It was removed from `SessionStart` because the first turn
  resolved it twice. The variable changes no script behavior — `session:lang` reads it only to
  display it.
