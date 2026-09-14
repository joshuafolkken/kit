import { backlog_budget_cli } from '#scripts/backlog/backlog-budget-cli'
import { run_issue_number } from './run-issue-number'

// The grammar of an invocation that can be carried across a session cut, and the only place it is
// written down (joshuafolkken/kit#1774, folded into `backlogrun` by joshuafolkken/kit#1984). It sat
// inside `run-wake-session.ts` while that supervisor was its one reader; two now need the same answer
// — the supervisor, to rebuild the text it wakes with, and `run-carry.ts`, to say which of a
// `backlogrun`'s named issues are still outstanding. A grammar copied into two files is a grammar
// kept correct in one, which is the clone `CLAUDE.md` prohibits.
//
// **`backlogrun` is the one command that survives a cut, and its invocation is a named-issue list, a
// budget, or both.** `backlogrun #N1 #N2 …` runs the named issues in the order they were typed and
// then drains the opted-in backlog; `backlogrun --max 5 --idle 30` names only a budget; the two
// combine as `backlogrun #N1 #N2 --max 5`. The named list is what `queue` used to be its own keyword
// for (joshuafolkken/kit#1984 removed that keyword).
//
// **The invocation is taken apart and rebuilt, rather than inspected and handed on.** Everything that
// may reach the operating system is enumerable: one command word, two flag names, and an integer for
// each argument. Reading the record as tokens and composing a fresh string out of constants and
// validated integers means the text the record held never reaches `spawn` at all.
//
// **A stricter check is not a break in the flow, and that is why three of them changed nothing.**
// Validating the characters, fixing the binary as a constant and matching against a pattern all left
// the recorded string flowing into the call; taint tracking follows where a value goes, not how hard
// it was looked at on the way. Composing the argument from constants is what actually severs it
// (joshuafolkken/kit#1719).
const BACKLOG_COMMAND = 'backlogrun'
// **The named list is pinned to what was typed.** The record keeps the opening list unchanged across
// every cut, so `classify_claim`'s character-for-character comparison is untouched and
// joshuafolkken/kit#1722's single-writer guarantee is not weakened. What shrinks is the *outstanding*
// set, and that lives in the record's `done` field rather than in the string — the alternative,
// loosening the comparison to the keyword, is what joshuafolkken/kit#1774 rejected.
//
// The flags this grammar knows how to carry across a session cut. A token is compared against these
// and the **constant that matched** is what goes into the rebuilt invocation, never the token itself:
// the two are equal as text and differ in where they came from, and here the origin is the whole point.
const KNOWN_FLAGS: ReadonlyArray<string> = ['--max', '--idle']
// `--only` is the one flag that takes no value — it says "run the named list and stop, do not drain the
// pool" (joshuafolkken/kit#1984). It is carried across a cut like any other part of the invocation, so
// a resumed session that reads it back does not silently start draining the backlog the person excluded.
const ONLY_FLAG = '--only'
const ISSUE_PREFIX = '#'
const TOKEN_SEPARATOR = ' '
const FIRST_TOKEN = 0
const FIRST_ARGUMENT_INDEX = 1
const VALUE_OFFSET = 1
const FLAG_PAIR_LENGTH = 2
// `--only` advances the scan by one token, having no value where a `--max` / `--idle` pair advances two.
const ONLY_STEP = 1
const EMPTY_LENGTH = 0
const NOT_FOUND = -1

// A space is the only separator that can survive `detached-launch.ts`'s `is_safe_value`, which has
// already refused every control character — so the split needs no pattern, and this file is left with
// no regular expression of its own for a backtracking analysis to find. The one pattern it does use
// is `run-issue-number.ts`'s, which is anchored and has no alternation.
function tokens_of(invocation: string): ReadonlyArray<string> {
	return invocation.split(TOKEN_SEPARATOR).filter((token) => token.length > EMPTY_LENGTH)
}

// **The integer check is `backlog:budget`'s own, imported rather than restated.** It is the command
// this invocation is going to be handed to, so a second copy of the rule here would be free to drift
// from the one that actually reads the number.
function flag_token(token: string, raw: string | undefined): string | undefined {
	const flag = KNOWN_FLAGS.find((known) => known === token)
	const value = backlog_budget_cli.to_count(raw)

	if (flag === undefined || value === undefined) return undefined

	return `${flag} ${String(value)}`
}

// One rendered flag and how far it advanced the scan: two tokens for a valued flag, one for `--only`.
// The advance is returned rather than assumed, so `flag_tokens` handles a valueless flag mixed in with
// the pairs without knowing which kind it read.
interface FlagRead {
	part: string
	advance: number
}

// **`--only` is read before the valued flags**, because it is the one token that carries no value: read
// as a valued flag it would swallow whatever follows it as its argument. It renders to its own constant
// for the same taint reason every other token does — the constant severs the record's string from the
// rebuilt one.
function read_flag(tokens: ReadonlyArray<string>, index: number): FlagRead | undefined {
	const token = tokens[index] ?? ''

	if (token === ONLY_FLAG) return { part: ONLY_FLAG, advance: ONLY_STEP }

	const part = flag_token(token, tokens[index + VALUE_OFFSET])

	return part === undefined ? undefined : { part, advance: FLAG_PAIR_LENGTH }
}

// **An unknown flag is refused, never dropped.** Dropping one would wake a session running to a budget
// the person did not declare the first time `backlogrun` grows a flag this list has not caught up with
// — which is the failure that is hardest to notice, because the session runs and looks fine. A stray
// `#N` after the flags lands here too, as a token that matches no known flag, and is refused: the
// named list is the invocation's leading block, never interleaved with the budget.
function flag_tokens(
	tokens: ReadonlyArray<string>,
	start: number,
): ReadonlyArray<string> | undefined {
	const rendered: Array<string> = []
	let index = start

	while (index < tokens.length) {
		const read = read_flag(tokens, index)

		if (read === undefined) return undefined

		rendered.push(read.part)
		index += read.advance
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

// The named issues are the leading block of `#N` tokens, in the order they were typed. The scan stops
// at the first token that is not an issue reference — that is where the budget flags begin — and a
// `#`-prefixed token that does not validate refuses the whole invocation rather than being read as the
// start of the flags. An empty block is a valid answer here (a bare `backlogrun` or a budget-only one);
// `issue_numbers` is where "no named issues" becomes `undefined`.
// The contiguous leading block of `#`-prefixed tokens — everything up to the first token that is not
// an issue reference, which is where the budget flags begin.
function take_leading_prefixed(args: ReadonlyArray<string>): ReadonlyArray<string> {
	const stop = args.findIndex((token) => !token.startsWith(ISSUE_PREFIX))

	return args.slice(FIRST_TOKEN, stop === NOT_FOUND ? args.length : stop)
}

function leading_issues(tokens: ReadonlyArray<string>): ReadonlyArray<number> | undefined {
	const issues: Array<number> = []
	const prefixed = take_leading_prefixed(tokens.slice(FIRST_ARGUMENT_INDEX))

	for (const token of prefixed) {
		const issue = issue_of(token)

		if (issue === undefined) return undefined

		issues.push(issue)
	}

	return issues
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
function rebuilt_backlog(tokens: ReadonlyArray<string>): string | undefined {
	const issues = leading_issues(tokens)

	if (issues === undefined) return undefined

	const flags = flag_tokens(tokens, FIRST_ARGUMENT_INDEX + issues.length)

	if (flags === undefined) return undefined

	return joined(BACKLOG_COMMAND, [...issues.map((issue) => issue_token(issue)), ...flags])
}

// The command word is compared against this file's own constant and the **constant** is what the
// rebuilt text is composed from, so no token of the record survives into the result.
function rebuild(invocation: string): string | undefined {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== BACKLOG_COMMAND) return undefined

	return rebuilt_backlog(tokens)
}

// The issues a `backlogrun` invocation named, in the order it named them. An invocation with no named
// list — a bare `backlogrun`, or a budget-only one — answers `undefined` rather than an empty array:
// "this invocation named no issues" and "this run has no issues left" are different facts, and a
// caller that could not tell them apart would report a finished sequential run as one that never had a
// list. A malformed leading `#N` answers `undefined` too, because there is then no list to trust.
function issue_numbers(invocation: string): ReadonlyArray<number> | undefined {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== BACKLOG_COMMAND) return undefined

	const issues = leading_issues(tokens)

	if (issues === undefined || issues.length === EMPTY_LENGTH) return undefined

	return issues
}

// Whether the invocation carries `--only`, so a resumed session runs the named list and stops rather
// than draining the pool. It reads the token from the same grammar `rebuild` composes from, so the two
// cannot disagree on what `--only` looks like. A non-`backlogrun` invocation carries none, which is
// `false`.
function has_only(invocation: string): boolean {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== BACKLOG_COMMAND) return false

	return tokens.slice(FIRST_ARGUMENT_INDEX).includes(ONLY_FLAG)
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
