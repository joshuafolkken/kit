# Never put a body in shell double quotes — rationale

This is maintainer-only rationale behind `prompts/collaboration-workflow/shell-body.md` — the
incidents, measurements and arguments that justify the procedure's boundaries, trigger and blind
spots. No run reads it. Every trigger, command, verdict and boundary an agent follows stays in the
procedure, and a change to this file changes no rule.

## The incidents — two kinds of damage, one cause

In one run, the procedure's "What happens" call (a `gh api ... -f body="…"` whose body held the
backticked word `pnpm josh ms`) **switched the lane's work tree to `main` and stopped the run**.
Recovery was manual.

The same root reaches a second mouth. A backticked word (`` `owner/repo#` ``) in a body passed to
`pnpm josh followup --notify-message "…"` was replaced by an empty string, and the word vanished from
the first line of the Telegram notice. **Only the severity differs; the cause is the same.**

## Why `!` is not a trigger

An Issue comment said `!` fires too, but **it does not fire in this environment** (measured in
non-interactive zsh). It is not a trigger either — bodies containing "!" are everyday, and a hook
that refused on them would be exactly
["a hook that fires on the wrong turn"](../../prompts/collaboration-workflow/rule-delivery.md).

## Why no `gh` subcommand is written in an executable block

`gh issue comment` / `gh pr comment` have `--body-file` too, but this repository's distributed
documents do not put GraphQL-backed `gh` subcommands in executable blocks — they answer 403 in a cloud
session (`scripts/gh/gh-document-guard.test.ts`).

## The comments lost to `-f body=@`

`-f` and `-F` differ by one character, and `gh` exits 0 for either. Two park comments were lost this
way, and nobody knew they were broken until a person later looked at the Issue. That is why posting a
comment was narrowed to the single spelling `pnpm josh issue:comment`.

## Why `--body` and `--body-file` together are refused

Choosing a precedence would let a call meant to pass a file send the very inline string it was
avoiding. So passing both is refused rather than resolved in favor of either.

## Why it is a triggered delivery

**That writing a rule down is not enough to have it followed has been measured repeatedly in this
repository** ([`rule-delivery.md`](../../prompts/collaboration-workflow/rule-delivery.md)). So this rule
rides as one row of that mechanism, and `pnpm josh rule:guard` refuses the matching `Bash` call and
puts the rule in front of the run. The enumeration's row is `shell-body` in
`scripts/rules/delivered-rules.ts`, and the trigger it reads — which spellings carry a body inline and
what the shell does to that value — is in `scripts/rules/shell-body-trigger.ts`.

Some spellings are invisible to the trigger, so the resident line in `CLAUDE.md` stays. Delivery
reaches Claude Code alone (Codex / Gemini / Cursor run no hooks), and the rule must not shrink to the
spellings the pattern knows.

## Why the trigger reads the body, not the flag

Every example in this repository's prompts passes a placeholder (`-f body="<plan>"`), which is
harmless. A flag trigger would refuse on those turns too, where the rule is already followed. Only the
moment a body that actually holds a backtick or `$` lands in double quotes is a call whose text gets
executed.

## Marker tests

- `scripts/josh/cli-body.test.ts` — a body holding backticks or `$` passes through a file unchanged,
  `-` reads stdin, readable non-regular paths (`/dev/stdin`, process substitution) open, and passing
  inline and file together is refused
- `scripts/rules/shell-body-trigger.test.ts` — it fires on the dangerous spellings and is silent on a
  placeholder, the `@file` form and an escaped `\$`. Firing and non-firing pairs pin that it fires
  whichever side of `body=` the quote sits on, that wrapping in `$( … )` does not exempt a backtick,
  and that a quote inside `$( … )` does not cut the capture short
- `scripts/rules/raw-field-body.test.ts` — it fires on the `-f` / `--raw-field body=@` spellings and
  is silent on `-F` / `--field body=@`, a body without `@`, `labels[]=` and `pnpm josh issue:comment`
- `scripts/rules/delivered-rules.test.ts` — the triggers above are wired to the enumeration's row, and
  it is silent for non-`Bash` tools
- `scripts/rules/shell-body-rule.test.ts` — the resident line points at the procedure, and the message
  carries the damage, the safe spelling and the reissue instruction. **It pins this list too** — the
  list once credited a suite with a case it did not have (stdin `-`), a line that read as coverage and
  was not
