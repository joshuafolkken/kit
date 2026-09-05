import { cost_blocks } from '#scripts/cost/cost-blocks'
import { json_value } from '#scripts/json-value'

// Reading a shell command well enough to name what it ran (joshuafolkken/kit#1344).
//
// It was `time-spans.ts`'s, and it moved out when that file passed its length limit. The seam is the
// one `time-format.ts` was cut along: this holds no timing knowledge at all — no spans, no
// categories, no timeline — so the dependency stays one-way, and `time-bundle-call.ts` can ask it
// which command a call ran without either of them importing the other.
//
// The rationale below is the original's, moved rather than rewritten.

// A Bash call is bundled under the command it runs, because `Bash` alone is the largest row in every
// session and says nothing: `git`, `gh` and `pnpm` are different work with different costs.
//
// **The first word is not always the command.** Most calls here open with `cd <path> &&`, and taking
// the literal first word put `Bash: cd` at the top of every table — 82 calls and 12.1 minutes of one
// measured session, naming the one part of the command that did no work. So the chain is split into
// segments and each segment walked past its leading `VAR=…` assignments and its wrappers, to the
// first word that is a command.
//
// **A prefix is skipped word by word, not segment by segment.** Reading only each segment's first
// word left `FOO=1 pnpm test` reported as `Bash: FOO=1` and `time pnpm build` as `Bash: time` — the
// same defect one level down, and worse, because the bucket is then keyed by the *value*, so one
// command scatters across a row per environment it ran under.
const BASH_SEPARATOR = ': '
const WHITESPACE_PATTERN = /\s+/u
const SEGMENT_PATTERN = /&&|\|\||;|\|/u
// A command name never opens with `-`; that is a flag, and a flag became the label whenever the walk
// landed on one (`Bash: -t`, from `F=$(ls -t *.jsonl | head -1)`).
const COMMAND_WORD_PATTERN = /^[\w./@:+][\w./@:+-]*$/u
const ASSIGNMENT_PATTERN = /^\w+=/u

// `VAR=$(cmd …)` runs `cmd`, and in the transcripts measured the subshell was always the real work —
// `A=$(gh api …)`, `F=$(ls -t …)`. Dropping the opener leaves that command in the segment's word
// stream, where the walk finds it like any other; without it the walk skipped the assignment whole
// and labelled the call after whatever word happened to follow (`Bash: api`).
const SUBSHELL_OPENER = '$('
const FLAG_PREFIX = '-'

// Two kinds of prefix, and they are not interchangeable. A wrapper runs the command that follows it,
// so the walk continues past it; a navigation builtin runs nothing, so its segment yields no command
// at all and the walk moves to the next segment.
const WRAPPER_COMMANDS = new Set(['time', 'env', 'sudo'])
const NAVIGATION_COMMANDS = new Set(['cd', 'pushd', 'popd', 'export', 'source', 'set', '.'])

// Anchored at a segment's command position, not searched anywhere in the string. A loose search
// charged `git commit -m "ran pnpm josh gate"` to `josh gate`, and this repository's own commit
// messages and issue comments name josh subcommands constantly. Only the first match counts: a
// compound command naming two would otherwise charge its whole duration to each.
const JOSH_PATTERN = /^(?:pnpm\s+(?:exec\s+)?)?josh\s+([a-z][\w:-]*)/u
const JOSH_PREFIX = 'josh '
const COMMAND_KEY = 'command'

function bash_command(input: unknown): string {
	if (!json_value.is_record(input)) return ''

	const command = input[COMMAND_KEY]

	return typeof command === 'string' ? command : ''
}

// A wrapper's own flags are skipped with it. Skipping only the wrapper word left the walk on a flag,
// which is not command-shaped, so `env -i pnpm test` yielded no command at all and its duration left
// the per-command table entirely.
function is_skippable(word: string): boolean {
	if (word.startsWith(FLAG_PREFIX)) return true

	return ASSIGNMENT_PATTERN.test(word) || WRAPPER_COMMANDS.has(word)
}

// One segment with its leading assignments and wrappers dropped, so the first entry is the command
// position. Shared by both readers below: what counts as the command is one rule, not two.
function command_words(segment: string): Array<string> {
	const words = segment.replaceAll(SUBSHELL_OPENER, ' ').trim().split(WHITESPACE_PATTERN)
	const start = words.findIndex((word) => !is_skippable(word))

	return start === -1 ? [] : words.slice(start)
}

// The command this segment runs, or nothing. Nothing has two causes and both are deliberate: a
// navigation builtin runs no command, and a word that is not command-shaped is a fragment the split
// produced — cutting on `;` inside `python3 -c 'import time; print(x)'` leaves `print(x)'`, which is
// not a tool name and must not become a row.
function segment_command(segment: string): string {
	const [head] = command_words(segment)

	if (head === undefined || NAVIGATION_COMMANDS.has(head)) return ''

	return COMMAND_WORD_PATTERN.test(head) ? head : ''
}

// The one segment that runs the command. Both readers below decide from this same segment, so what
// counts as "where the command is" is settled once: reading the josh subcommand from *any* segment
// instead let a quoted argument containing a shell operator — `gh api -f body="see | pnpm josh lint"`,
// and this repository's issue bodies quote command chains constantly — synthesize a segment starting
// at `pnpm josh` and charge a `gh` call to a subcommand it never ran.
function command_segment(command: string): string {
	return command.split(SEGMENT_PATTERN).find((segment) => segment_command(segment) !== '') ?? ''
}

// Splitting on `|` can cut inside a quoted pattern, which is harmless: only the *first* segment that
// runs something is read, and a quote opened later cannot change what its command position held.
function leading_word(command: string): string {
	return segment_command(command_segment(command))
}

// A call nothing could be named for stays under the bare tool name. Naming it after the word that
// was rejected — the old fallback — is what put `Bash: FOO=1` in the table.
function bash_label(command: string): string {
	const word = leading_word(command)

	return word === '' ? cost_blocks.BASH_TOOL : `${cost_blocks.BASH_TOOL}${BASH_SEPARATOR}${word}`
}

function josh_command_of(command: string): string {
	const words = command_words(command_segment(command))
	const name = JOSH_PATTERN.exec(words.join(' '))?.[1]

	return name === undefined ? '' : `${JOSH_PREFIX}${name}`
}

const time_shell = {
	bash_command,
	bash_label,
	josh_command_of,
	leading_word,
}

export { time_shell }
