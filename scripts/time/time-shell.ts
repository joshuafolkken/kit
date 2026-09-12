import { cost_blocks } from '#scripts/cost/cost-blocks'
import { canonical_command } from '#scripts/josh/josh-command-map'
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
// A pipe alone, never the `||` that happens to be spelled with the same character twice. The two are
// opposites for the purpose below: a pipeline throws away the exit status of every command but its
// last, while `||` keeps the first command's and runs the second only when it failed. `|&` is a pipe
// and is cut here, its `&` left in the fragment that follows.
const PIPE_PATTERN = /(?<!\|)\|(?!\|)/u
// What `SEGMENT_PATTERN` cuts on minus the pipe, for reading *inside* one pipe segment.
const CHAIN_PATTERN = /&&|\|\||;/u
// A quoted span is text, not shell syntax, and it is removed before the pipe reading below. This
// repository's issue bodies, comment bodies and commit messages quote command chains constantly, so
// `--body "cd x && pnpm josh gate | tail"` is a `gh` call and nothing else — a reader that split its
// quoted text would answer about a command the shell never ran. Whichever quote opens first consumes
// to its own close, so the `'` inside `"it's fine"` is a character rather than an opener.
//
// **The trade-off, stated rather than left to be discovered.** A shell does execute its quoted
// argument — `bash -c "pnpm josh gate | tail"`, `sh -c`, `ssh host "…"` — and that pipeline becomes
// invisible here. Erring this way is the cheaper error for every caller: a missed reading costs
// nothing beyond the reading, while a fragment read as a command answers about work the shell never
// did, on the shape this repository writes constantly.
const QUOTED_SPAN_PATTERN = /'[^']*'|"[^"]*"/gu
// `set -o pipefail` tells the shell to report the pipeline with the first failing command's status,
// so nothing in it is discarded. The flag letters are loose because `set -eo pipefail` and
// `set -euo pipefail` are the same instruction, and the `set` word is required so that a path or a
// message merely containing "pipefail" cannot turn the reading off.
const PIPEFAIL_PATTERN = /\bset\s+-[a-z]*o\s+pipefail\b/u
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

// Every command a pipeline throws the exit status of away — one per `|`-separated segment except the
// last (joshuafolkken/kit#1556). A shell reports a pipeline with its final command's status, so a
// check run anywhere earlier has its verdict discarded before anything reads it.
//
// **The command of a segment is at the end of its chain, not the start.** `|` binds tighter than `&&`
// and `;`, so `cd x && pnpm josh gate | tail` runs `cd x && (pnpm josh gate | tail)` and what the pipe
// discards is `pnpm josh gate`; taking the segment's first command would name `cd` and miss every
// check written behind a directory change, which is how nearly all of them are written here.
//
// **Quoted text is removed first, and here that is load-bearing rather than tidy.** `command_segment`
// can tolerate a quote-cut fragment because it only reads the *first* segment that runs something;
// this reader walks into the middle of a chain, where a quoted `… && pnpm josh gate | tail` inside a
// `gh` comment body would otherwise be answered for as though the check had run.
//
// **A pipeline under `set -o pipefail` discards nothing**, so it is not this function's business —
// answering otherwise would name the very form a caller is told to use instead.
// Quoted text replaced by a space, which is what a reader walking into the middle of a chain has to
// do before it can trust an operator it finds there. Exported because `time-writes.ts` needs the same
// removal for a different reason — a quoted `sed` script holds `|` and slashes that read as a
// pipeline and as paths — and two spellings of "remove the quotes" would disagree the first time one
// of them learned about a quoting form the other did not.
function unquoted(command: string): string {
	return command.replaceAll(QUOTED_SPAN_PATTERN, ' ')
}

function discarded_commands(command: string): Array<string> {
	const plain = unquoted(command)

	if (PIPEFAIL_PATTERN.test(plain)) return []

	return plain
		.split(PIPE_PATTERN)
		.slice(0, -1)
		.map((segment) => segment.split(CHAIN_PATTERN).at(-1) ?? '')
}

// A call nothing could be named for stays under the bare tool name. Naming it after the word that
// was rejected — the old fallback — is what put `Bash: FOO=1` in the table.
function bash_label(command: string): string {
	const word = leading_word(command)

	return word === '' ? cost_blocks.BASH_TOOL : `${cost_blocks.BASH_TOOL}${BASH_SEPARATOR}${word}`
}

// **An alias is expanded here, so one command is one name** (joshuafolkken/kit#1789). Every reading
// built on this field keyed `pnpm josh ga` and `pnpm josh gate` as two different commands: the
// per-command table printed them as two rows, the per-invocation table dropped both for having one
// call each, and — the one with real cost — the failure chain did not see the second as answering the
// first, so the time a red gate made the run pay again went unreported.
//
// **The expansion belongs at the name, not at each reader.** `time-gate-runs.ts` had already patched
// its own copy of this reading, which left the gate count and the per-invocation table answering
// differently about the same run; `canonical_command` is the one rule both now go through.
// The josh subcommand one segment runs, alias-expanded, or `''` for a segment that runs none. Shared
// by the two readers below so what counts as a segment's josh command is one rule, not two.
function josh_command_of_segment(segment: string): string {
	const name = JOSH_PATTERN.exec(command_words(segment).join(' '))?.[1]

	return name === undefined ? '' : `${JOSH_PREFIX}${canonical_command(name)}`
}

function josh_command_of(command: string): string {
	return josh_command_of_segment(command_segment(command))
}

// Every josh subcommand a chained call ran, not just the first (joshuafolkken/kit#1883). The standard
// verification form `pnpm josh lint:related && pnpm josh test:related` is two commands in one call, and
// `josh_command_of` reads only the first segment's — so a table built on that field never counted
// `test:related`. This reads every segment instead.
//
// **Quoted text is removed first, which `josh_command_of` did not need.** That reader tolerates a
// quote-cut fragment because it only looks at the first segment that runs something; this one walks the
// whole chain, where a quoted `… && pnpm josh lint` inside a `gh` body would otherwise synthesize a
// josh command the shell never ran — the same removal `discarded_commands` makes for the same reason.
function josh_commands_of(command: string): Array<string> {
	return unquoted(command)
		.split(SEGMENT_PATTERN)
		.map((segment) => josh_command_of_segment(segment))
		.filter((name) => name !== '')
}

// A redirection is not an argument, and keeping one splits a single check into two signatures
// (joshuafolkken/kit#1383). Measured on run #1379, every `pnpm josh <check>` call there was written
// `… 2>&1`, so an otherwise identical call written without one would have keyed differently and the
// repeat between them would have gone uncounted.
//
// **A token ending in a redirection character takes the next one with it**, because that one is the
// file — `> out.txt` and `< list.txt` are two words each. **Both characters, not only `>`**: reading
// `<` as a redirection but not consuming its file left `list.txt` in the argument list, which is
// exactly the split this function exists to prevent. `2>&1` carries its own target inside the token,
// so nothing follows it.
const REDIRECTION_CHARACTERS: ReadonlyArray<string> = ['<', '>']

function is_redirection(word: string): boolean {
	return REDIRECTION_CHARACTERS.some((character) => word.includes(character))
}

function ends_in_redirection(word: string): boolean {
	return REDIRECTION_CHARACTERS.some((character) => word.endsWith(character))
}

function drop_redirections(words: ReadonlyArray<string>): Array<string> {
	const kept: Array<string> = []
	let is_target = false

	for (const word of words) {
		const is_dropped = is_target || is_redirection(word)

		is_target = ends_in_redirection(word)
		if (!is_dropped) kept.push(word)
	}

	return kept
}

// What a `pnpm josh <cmd>` call passes after its subcommand (joshuafolkken/kit#1383).
//
// **Read from the same segment `josh_command_of` reads the subcommand from**, and past the same
// match. Two calls of one check are told apart by their arguments, so a second reader here would be
// the one place where the command and its arguments could come from different halves of a chain —
// `cd x && pnpm josh test:related a.ts | tail -5` has three segments, and only one of them ran the
// check.
//
// **The match's own text is what is sliced off, not a fixed word count.** The prefix is two words in
// `josh lint`, three in `pnpm josh lint` and four in `pnpm exec josh lint`, so counting words would
// leave `josh` itself in the argument list for one of the three spellings.
function josh_arguments(command: string): Array<string> {
	const text = command_words(command_segment(command)).join(' ')
	const match = JOSH_PATTERN.exec(text)

	if (match === null) return []

	const words = text
		.slice(match[0].length)
		.split(WHITESPACE_PATTERN)
		.filter((word) => word !== '')

	return drop_redirections(words)
}

const time_shell = {
	JOSH_PREFIX,
	bash_command,
	bash_label,
	command_segment,
	discarded_commands,
	josh_arguments,
	josh_command_of,
	josh_commands_of,
	leading_word,
	unquoted,
}

export { time_shell }
