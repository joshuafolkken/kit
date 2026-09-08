// The `shell-body` row's trigger, in a module of its own rather than inside the enumeration
// (joshuafolkken/kit#1198). Every other row's trigger is already shaped that way — `time_batch_guard`
// and `cost_blocks` each hold their own reading of a call — and this one needs a small model of what
// zsh does inside double quotes, which is more than an enumeration row should carry. The split also
// gives that model a suite of its own, so a regex change is read beside the cases it has to keep.

// A body handed to a command as an inline double-quoted argument, in the spellings a run reaches for:
// `gh`'s field flags (`-f` / `-F` / `--field` / `--raw-field` with `body=`), `gh`'s own `--body`, and
// `josh`'s `--body` and `--notify-message`. The value is captured so the decision can be made on what
// the body actually contains rather than on the flag alone.
//
// **`-b` is deliberately absent.** It is `gh`'s short `--body`, but it is also `git checkout -b`, and
// a branch name is not a body — covering it would refuse calls where nothing is wrong. The `*-file`
// spellings end in `-` where this pattern needs whitespace or `=`, so `--body-file <path>` and
// `--notify-message-file <path>` cannot match it.
const FIELD_FLAGS = '(?:-f|-F|--field|--raw-field)'
const MESSAGE_FLAGS = '(?:--body|--notify-message)'

// **The opening quote sits on either side of `body=`, and both spellings are the same command.** zsh
// strips the quotes before `gh` is started, so `-f body="… \`pnpm josh ms\` …"` and
// `-f "body=… \`pnpm josh ms\` …"` hand `gh` one identical argument and execute one identical
// backtick. A pattern that knew only the first fired on half of the calls it was written for.
//
// **They are two alternatives rather than one optional quote on each side.** An optional quote after
// `body=` would also match `--field body=@$HOME/b.md`, capture the unquoted path up to some later
// quote, find the `$` in it and refuse the very file form this rule asks callers to use.
//
// **The separator is `=` as readily as whitespace**, because `gh` accepts `--field=body="…"` for the
// same reason `--body=…` works — which `MESSAGE_OPENING` below has always allowed. A pattern that
// only knew the space stayed silent on a call that executes the backtick.
const FIELD_OPENING = String.raw`${FIELD_FLAGS}[\s=]*(?:'?body="|"body=)`
const MESSAGE_OPENING = String.raw`${MESSAGE_FLAGS}[\s=]+"`

// One command substitution nested inside another — the `$(pwd)` of `$(cat "$(pwd)/x.md")`. One level
// is every spelling a run composes; deeper nesting stops matching and is read as ordinary text.
const NESTED_SUBSTITUTION = String.raw`\$\([^()]*\)`

// A whole command substitution, the quotes inside it included. **It belongs to the value pattern and
// not only to the exemption below**: `"` is legal inside `$( … )`, so a value that stopped at the
// first one truncated `$(cat "$(pwd)/x.md")` to `$(cat `, found the `$` and refused a caller who was
// already passing the body by path — spending the run's one delivery on a call that kept the rule.
//
// The branches are kept disjoint — `[^()$]` excludes the `$` the other two start with — so the match
// is linear rather than a nested quantifier that backtracks.
const SUBSTITUTION = String.raw`\$\((?:[^()$]|\$(?!\()|${NESTED_SUBSTITUTION})*\)`

// The text between the opening quote and the closing one: ordinary characters, a backslash escape, a
// lone `$`, or a whole substitution consumed in one piece so its inner quotes do not end the value.
const QUOTED_VALUE = String.raw`(?:[^"\\$]|\\.|\$(?!\()|${SUBSTITUTION})*`

const INLINE_BODY_VALUE = new RegExp(
	`(?:${FIELD_OPENING}|${MESSAGE_OPENING})(${QUOTED_VALUE})"`,
	'gu',
)

// **What zsh evaluates inside double quotes, measured in this harness rather than assumed**
// (joshuafolkken/kit#1198): a backtick runs as command substitution and a `$` expands. `!` does
// **not** — history expansion is off in a non-interactive zsh, and `"hello!world"` survives intact —
// so it is deliberately absent: a rule that fired on every exclamation mark would be firing on turns
// where nothing is wrong, which `prompts/collaboration-workflow/rule-delivery.md` names as worse than
// no hook at all.
const SHELL_EVALUATED = /[`$]/u

// **The one exemption: a body that is *entirely* one command substitution.** `body="$(cat <path>)"`
// is the rule already being kept — the substitution's output is not re-scanned by the shell, so a
// body full of backticks reaches the command byte for byte, and refusing it would spend the run's one
// delivery on a caller who had already moved the body into a file.
//
// **It is anchored to the whole value, not to the `$(` alone.** Excusing `$(` anywhere would let
// `body="Result: run $(git log -1) to confirm"` through, and that one really is evaluated: the
// substitution replaces the text and the command runs.
const WHOLE_VALUE_SUBSTITUTION = new RegExp(`^${SUBSTITUTION}$`, 'u')

// **A backtick inside the substitution voids the exemption.** The exemption's reason is that the
// *output* is not re-scanned — but the substitution's own command is shell text, and a backtick in it
// runs exactly as an inline one does. `body="$(echo \`date\`)"` executes `date`, which is the damage
// joshuafolkken/kit#1198 was filed over, merely written one level in. A nested `$( … )` is the safe
// spelling of the same composition and stays exempt.
const BACKTICK = '`'

// **The other spelling of "already in a file": `body=@<path>`.** The unquoted `--field body=@<path>`
// never reaches the pattern at all, and `--field "body=@$HOME/body.md"` is that same call with the
// quote moved one character left — so it is excused for the same reason, and by the same shape of
// test as the substitution above: the *whole* value is the reference. A body that merely opens with
// an `@mention` is not one, so it carries a space and still fires.
const WHOLE_VALUE_FILE_REFERENCE = /^@\S+$/u

// A backslash escape makes the next character literal inside double quotes, so `\$` and `` \` `` are
// safe. They are dropped before the test rather than excluded from it, which is the same thing in one
// pass and keeps `SHELL_EVALUATED` readable.
const ESCAPED_PAIR = /\\./gu

function is_whole_value_substitution(literal: string): boolean {
	return WHOLE_VALUE_SUBSTITUTION.test(literal) && !literal.includes(BACKTICK)
}

function is_body_already_in_a_file(literal: string): boolean {
	return WHOLE_VALUE_FILE_REFERENCE.test(literal) || is_whole_value_substitution(literal)
}

function is_evaluated_value(raw_value: string): boolean {
	const literal = raw_value.replaceAll(ESCAPED_PAIR, '')

	if (is_body_already_in_a_file(literal)) return false

	return SHELL_EVALUATED.test(literal)
}

// **The trigger is the body's content, not the flag.** Every worked example in this repository's
// prompts passes a placeholder (`-f body="<plan>"`), which is inert; the moment a real body carrying
// a backtick is substituted in, the call becomes the one that executes text. Keying on the flag would
// refuse the inert examples too — firing on turns where the rule is already being kept.
function is_shell_evaluated_body(command: string): boolean {
	for (const match of command.matchAll(INLINE_BODY_VALUE)) {
		if (is_evaluated_value(match[1] ?? '')) return true
	}

	return false
}

const shell_body_trigger = { is_shell_evaluated_body }

export { shell_body_trigger }
