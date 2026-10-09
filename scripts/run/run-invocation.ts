import { backlog_budget_cli } from '#scripts/backlog/backlog-budget-cli'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_issue_number } from './run-issue-number'

// The grammar of an invocation that can be carried across a session cut, and the only place it is
// written down. Two readers need the same answer — the supervisor, to rebuild the text it wakes with,
// and `run-carry.ts`, to say which of a `backlogrun`'s named issues are still outstanding. A grammar
// copied into two files is a grammar kept correct in one, which is the clone `CLAUDE.md` prohibits.
//
// **`backlogrun` is the one command that survives a cut, and its invocation is a named-issue list, a
// budget, or both.** `backlogrun #N1 #N2 …` runs the named issues in the order they were typed and
// then drains the opted-in backlog; `backlogrun --max 5 --idle 30` names only a budget; the two
// combine as `backlogrun #N1 #N2 --max 5`.
//
// **The invocation is taken apart and rebuilt, rather than inspected and handed on.** Everything that
// may reach the operating system is enumerable: one command word, two flag names, and an integer for
// each argument. Reading the record as tokens and composing a fresh string out of constants and
// validated integers means the text the record held never reaches `spawn` at all.
//
// **A stricter check is not a break in the flow.** Validating the characters, fixing the binary as a
// constant and matching against a pattern all leave the recorded string flowing into the call; taint
// tracking follows where a value goes, not how hard it was looked at on the way. Composing the
// argument from constants is what actually severs it.
const BACKLOG_COMMAND = 'backlogrun'
// **The named list is pinned to what was typed.** The record keeps the opening list unchanged across
// every cut, so `classify_claim`'s character-for-character comparison is untouched and the
// single-writer guarantee is not weakened. What shrinks is the *outstanding* set, and that lives in
// the record's `done` field rather than in the string.
//
// The flags this grammar knows how to carry across a session cut. A token is compared against these
// and the **constant that matched** is what goes into the rebuilt invocation, never the token itself:
// the two are equal as text and differ in where they came from, and here the origin is the whole point.
const KNOWN_FLAGS: ReadonlyArray<string> = ['--max', '--idle']
// `--only` is the one flag that takes no value — it says "run the named list and stop, do not drain the
// pool". It is carried across a cut like any other part of the invocation, so
// a resumed session that reads it back does not silently start draining the backlog the person excluded.
const ONLY_FLAG = '--only'
// The read itself is `cli_flags`'s: strict, so an unknown flag, a flag with
// no value, `--only=<x>` and a value that is itself a flag are all refused before this file looks.
const OPTIONS = {
	max: { type: 'string' },
	idle: { type: 'string' },
	only: { type: 'boolean' },
} as const
const ISSUE_PREFIX = '#'
const FLAG_PREFIX = '-'
const TOKEN_SEPARATOR = ' '
const FIRST_TOKEN = 0
const FIRST_ARGUMENT_INDEX = 1
const EMPTY_LENGTH = 0
const NOT_FOUND = -1

// One token of `parseArgs`'s `tokens` answer, as far as this file reads it: a positional's text, or an
// option's name and the value it was given (`--max 5` and `--max=5` alike).
interface ArgumentToken {
	kind: string
	name?: string
	value?: string | undefined
}

interface Invocation {
	issues: ReadonlyArray<number>
	flags: ReadonlyArray<string>
}

// A space is the only separator that can survive `detached-launch.ts`'s `is_safe_value`, which has
// already refused every control character — so the split needs no pattern, and this file is left with
// no regular expression of its own for a backtracking analysis to find. The one pattern it does use
// is `run-issue-number.ts`'s, which is anchored and has no alternation.
function tokens_of(invocation: string): ReadonlyArray<string> {
	return invocation.split(TOKEN_SEPARATOR).filter((token) => token.length > EMPTY_LENGTH)
}

// **The integer check is `backlog:budget`'s own, imported rather than restated.** It is the command
// this invocation is going to be handed to, so a second copy of the rule here would be free to drift
// from the one that actually reads the number. `--only` carries no value and renders to its own
// constant for the same taint reason every other token does — the constant severs the record's string
// from the rebuilt one.
function render_option(token: ArgumentToken): string | undefined {
	if (token.name === cli_flags.option_name(ONLY_FLAG)) return ONLY_FLAG
	const flag = KNOWN_FLAGS.find((known) => cli_flags.option_name(known) === token.name)
	const value = backlog_budget_cli.to_count(token.value)

	if (flag === undefined || value === undefined) return undefined

	return `${flag} ${String(value)}`
}

// **An unknown flag is refused, never dropped.** Dropping one would wake a session running to a budget
// the person did not declare the first time `backlogrun` grows a flag this list has not caught up with
// — which is the failure that is hardest to notice, because the session runs and looks fine. A stray
// `#N` after the flags lands here too, as a token that is no option, and is refused: the named list is
// the invocation's leading block, never interleaved with the budget. So is a `--` terminator.
function rendered_options(tokens: ReadonlyArray<ArgumentToken>): ReadonlyArray<string> | undefined {
	const rendered: Array<string> = []

	for (const token of tokens) {
		const part = render_option(token)

		if (part === undefined) return undefined

		rendered.push(part)
	}

	return rendered
}

// **The issue-number shape is `run-issue-number.ts`'s, for the reason the flag value's is
// `backlog:budget`'s.** It already refuses `0` and a leading zero, which is what keeps `#05` from
// rebuilding as `#5` and being refused downstream as a rewritten record.
// **The magnitude bound is here and not in the pattern**, which is anchored on digits and says nothing
// about size — the same shape `backlog_budget_cli.to_count` ends with for a flag value. Without it a
// number past `Number.MAX_SAFE_INTEGER` rebuilds as a different number through precision loss, and the
// record would carry a `done` entry that never matches anything in `remaining`.
function issue_of(token: string): number | undefined {
	if (!token.startsWith(ISSUE_PREFIX)) return undefined

	const digits = token.slice(ISSUE_PREFIX.length)

	if (!run_issue_number.ISSUE_NUMBER_PATTERN.test(digits)) return undefined

	const issue = Number(digits)

	return Number.isSafeInteger(issue) ? issue : undefined
}

// The named issues are the leading block of positionals, in the order they were typed, and each must be
// a `#N` that validates — anything else refuses the whole invocation rather than being dropped. An
// empty block is a valid answer here (a bare `backlogrun` or a budget-only one); `issue_numbers` is
// where "no named issues" becomes `undefined`.
function issues_of(tokens: ReadonlyArray<ArgumentToken>): ReadonlyArray<number> | undefined {
	const issues: Array<number> = []

	for (const token of tokens) {
		const issue = issue_of(token.value ?? '')

		if (issue === undefined) return undefined

		issues.push(issue)
	}

	return issues
}

// The arguments after the command word, as `parseArgs` tokens, or `undefined` for another command or
// an argument list the strict read refuses.
function argument_tokens(invocation: string): ReadonlyArray<ArgumentToken> | undefined {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== BACKLOG_COMMAND) return undefined

	return cli_flags.parse_or_undefined({
		args: tokens.slice(FIRST_ARGUMENT_INDEX),
		options: OPTIONS,
		allowPositionals: true,
		tokens: true,
	})?.tokens
}

// The named list is everything before the first option, and the budget flags everything from it on.
function parse(invocation: string): Invocation | undefined {
	const tokens = argument_tokens(invocation)
	if (tokens === undefined) return undefined
	const stop = tokens.findIndex((token) => token.kind !== 'positional')
	const split_at = stop === NOT_FOUND ? tokens.length : stop
	const issues = issues_of(tokens.slice(FIRST_TOKEN, split_at))
	const flags = rendered_options(tokens.slice(split_at))

	if (issues === undefined || flags === undefined) return undefined

	return { issues, flags }
}

function issue_token(issue: number): string {
	return `${ISSUE_PREFIX}${String(issue)}`
}

function joined(command: string, rendered: ReadonlyArray<string>): string {
	return [command, ...rendered].join(TOKEN_SEPARATOR)
}

// The named list rebuilds first and the budget flags after it, so the canonical text is
// `backlogrun #1 #2 --max 5` whatever spacing the record held. Both halves are composed from this
// file's own constants and validated integers, so no token of the record survives into the result.
// The command word is compared against this file's own constant and the **constant** is what the
// rebuilt text is composed from, so no token of the record survives into the result.
function rebuild(invocation: string): string | undefined {
	const parsed = parse(invocation)

	if (parsed === undefined) return undefined

	return joined(BACKLOG_COMMAND, [
		...parsed.issues.map((issue) => issue_token(issue)),
		...parsed.flags,
	])
}

// The issues a `backlogrun` invocation named, in the order it named them. An invocation with no named
// list — a bare `backlogrun`, or a budget-only one — answers `undefined` rather than an empty array:
// "this invocation named no issues" and "this run has no issues left" are different facts, and a
// caller that could not tell them apart would report a finished sequential run as one that never had a
// list. A malformed leading `#N` answers `undefined` too, because there is then no list to trust.
// Only the leading block is read, so a flag this grammar does not carry — `backlog:plan`'s `--exclude`
// — after it does not hide the named issues.
function issue_numbers(invocation: string): ReadonlyArray<number> | undefined {
	const tokens = tokens_of(invocation)
	const stop = tokens.findIndex((token) => token.startsWith(FLAG_PREFIX))
	const leading = stop === NOT_FOUND ? tokens : tokens.slice(FIRST_TOKEN, stop)
	const issues = parse(leading.join(TOKEN_SEPARATOR))?.issues

	if (issues === undefined || issues.length === EMPTY_LENGTH) return undefined

	return issues
}

// Whether the invocation carries `--only`, so a resumed session runs the named list and stops rather
// than draining the pool. It reads the flag from the same parse `rebuild` composes from, so the two
// cannot disagree on what `--only` looks like. A non-`backlogrun` invocation carries none, which is
// `false`.
function has_only(invocation: string): boolean {
	return parse(invocation)?.flags.includes(ONLY_FLAG) === true
}

// **Three entries, because three things call in.** The command word, the flag list and the token
// helpers are this module's own working parts; exporting them would invite a caller to reimplement the
// grammar out of its pieces, which is the clone this module exists to prevent.
const run_invocation = {
	has_only,
	issue_numbers,
	rebuild,
}

export { run_invocation }
