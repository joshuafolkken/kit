import { bash_triggers } from './bash-triggers'

// The trigger and the delivered text behind the `raw-field-body` row of `delivered-rules.ts`
// (joshuafolkken/kit#2304). Its sibling `shell-body` refuses a body a run passed *inline* so the shell
// evaluates it; this one refuses a body a run passed *by path with the wrong flag*, so the path is
// posted as text.
//
// **`gh api` has two spellings of "pass this by path" and one silently breaks.** `-F` / `--field`
// reads the file when the value opens with `@`; `-f` / `--raw-field` sends the value verbatim, so
// `-f body=@<path>` posts the literal string `@<path>`. The two differ by a single character, `gh`
// exits 0 and returns a comment URL either way, and the break is invisible until a person reads the
// issue — joshuafolkken/kit#2304 recorded two park comments (`@/tmp/2294-park.md` and a decision
// record) lost exactly this way, which was the only place the reason for a stopped child was written.
//
// **The trigger is the raw-field flag with an `@`-opening body, not `@` alone.** `-F` / `--field
// body=@<path>` is the spelling the rule *asks* for and stays silent; a `-f body="plain text"` with no
// `@` is not a file reference and stays silent; a `-f 'labels[]=needs-decision'` names no body and
// stays silent. Only a raw field whose `body=` value begins with `@` is the misfire.
//
// **It fires on every occurrence** (`git-force.ts`): each misfire posts a broken comment of its own,
// so refused-once-and-free-after would let the second one through.

// A raw field flag — `-f` or `--raw-field`, never the file-reading `-F` / `--field` — carrying a
// `body=` value that opens with `@`. The flag is anchored to a word boundary so the `-f` inside
// `--field` is not mistaken for the short raw flag, and the opening quote may sit on either side of
// `body=` (`-f "body=@…"` and `-f body="@…"` are one command to the shell), matching the shapes
// `shell-body-trigger.ts` reads.
const RAW_FIELD_BODY_AT = /(?:^|\s)(?:-f|--raw-field)[\s=]+['"]?body=['"]?@/u

function posts_at_path_literally(command: string): boolean {
	return RAW_FIELD_BODY_AT.test(command)
}

// The instruction in the shape a refusal can carry: what the flag is doing, the one-character trap
// that hides it, and the single command that cannot take the wrong flag. The damage is named because
// it reads as unbelievable — the call succeeds and returns a URL while posting the path as text.
const RAW_FIELD_BODY_REASON =
	'⛔ literal @path body: this passes `body=@<path>` to `gh api` with a raw field flag (`-f` / ' +
	'`--raw-field`), which sends the value verbatim — the string `@<path>` is posted as the comment, ' +
	'not the file it points at. `-F` / `--field` is the flag that reads the file, and the two spellings ' +
	'differ by one character while `gh` exits 0 and returns a comment URL either way, so the break is ' +
	'invisible until a person reads the issue (joshuafolkken/kit#2304 lost two park comments this way). ' +
	'Post an issue or PR comment with `pnpm josh issue:comment <N> --body-file <path>` — the one ' +
	'spelling, which cannot take the wrong flag. The rule and the safe forms are in ' +
	'`prompts/collaboration-workflow/shell-body.md`. This rule fires on every occurrence, not once per run.'

const ROW = {
	id: 'raw-field-body',
	is_trigger: bash_triggers.on_bash_command(posts_at_path_literally),
	reason: RAW_FIELD_BODY_REASON,
	decide: (): boolean => true,
}

const raw_field_body = { RAW_FIELD_BODY_REASON, ROW, posts_at_path_literally }

export { raw_field_body }
