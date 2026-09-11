import { backlog_budget_cli } from '#scripts/backlog/backlog-budget-cli'
import { run_issue_number } from './run-issue-number'

// The grammar of an invocation that can be carried across a session cut, and the only place it is
// written down (joshuafolkken/kit#1774). It sat inside `run-wake-session.ts` while `backlogrun` was
// the one entry point that survived a cut; `queue` is the second, and two readers now need the same
// answer — the supervisor, to rebuild the text it wakes with, and `run-carry.ts`, to say which of a
// queue's issues are still outstanding. A grammar copied into two files is a grammar kept correct in
// one, which is the clone `CLAUDE.md` prohibits.
//
// **The invocation is taken apart and rebuilt, rather than inspected and handed on.** Everything that
// may reach the operating system is enumerable: two command words, two flag names, and an integer for
// each argument. Reading the record as tokens and composing a fresh string out of constants and
// validated integers means the text the record held never reaches `spawn` at all.
//
// **A stricter check is not a break in the flow, and that is why three of them changed nothing.**
// Validating the characters, fixing the binary as a constant and matching against a pattern all left
// the recorded string flowing into the call; taint tracking follows where a value goes, not how hard
// it was looked at on the way. Composing the argument from constants is what actually severs it
// (joshuafolkken/kit#1719).
const BACKLOG_COMMAND = 'backlogrun'
// **A queue's invocation is its issue list, and the list is pinned to what was typed.** The record
// keeps the opening list unchanged across every cut, so `classify_claim`'s character-for-character
// comparison is untouched and joshuafolkken/kit#1722's single-writer guarantee is not weakened. What
// shrinks is the *outstanding* set, and that lives in the record's `done` field rather than in the
// string — the alternative, loosening the comparison to the keyword, is what joshuafolkken/kit#1774
// rejected.
const QUEUE_COMMAND = 'queue'
// The flags this grammar knows how to carry across a session cut. A token is compared against these
// and the **constant that matched** is what goes into the rebuilt invocation, never the token itself:
// the two are equal as text and differ in where they came from, and here the origin is the whole point.
const KNOWN_FLAGS: ReadonlyArray<string> = ['--max', '--idle']
const ISSUE_PREFIX = '#'
const TOKEN_SEPARATOR = ' '
const FIRST_TOKEN = 0
const FIRST_ARGUMENT_INDEX = 1
const VALUE_OFFSET = 1
const FLAG_PAIR_LENGTH = 2
const EMPTY_LENGTH = 0

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

// **An unknown flag is refused, never dropped.** Dropping one would wake a session running to a budget
// the person did not declare the first time `backlogrun` grows a flag this list has not caught up with
// — which is the failure that is hardest to notice, because the session runs and looks fine.
function flag_tokens(tokens: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	const rendered: Array<string> = []

	for (let index = FIRST_ARGUMENT_INDEX; index < tokens.length; index += FLAG_PAIR_LENGTH) {
		const part = flag_token(tokens[index] ?? '', tokens[index + VALUE_OFFSET])

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

// An empty list is refused rather than rebuilt as a bare `queue`: a queue with no issue is not an
// invocation a person can have typed, and waking a session on one would launch an agent with a prompt
// that names nothing to do.
function issues_of(tokens: ReadonlyArray<string>): ReadonlyArray<number> | undefined {
	const issues: Array<number> = []

	for (const token of tokens.slice(FIRST_ARGUMENT_INDEX)) {
		const issue = issue_of(token)

		if (issue === undefined) return undefined

		issues.push(issue)
	}

	return issues.length > EMPTY_LENGTH ? issues : undefined
}

function issue_token(issue: number): string {
	return `${ISSUE_PREFIX}${String(issue)}`
}

function joined(command: string, rendered: ReadonlyArray<string>): string {
	return [command, ...rendered].join(TOKEN_SEPARATOR)
}

function rebuilt_backlog(tokens: ReadonlyArray<string>): string | undefined {
	const rendered = flag_tokens(tokens)

	return rendered === undefined ? undefined : joined(BACKLOG_COMMAND, rendered)
}

function rebuilt_queue(tokens: ReadonlyArray<string>): string | undefined {
	const issues = issues_of(tokens)

	if (issues === undefined) return undefined

	return joined(
		QUEUE_COMMAND,
		issues.map((issue) => issue_token(issue)),
	)
}

// The command word is compared against this file's own constants and the **constant** is what the
// rebuilt text is composed from, so no token of the record survives into the result.
function rebuild(invocation: string): string | undefined {
	const tokens = tokens_of(invocation)
	const command = tokens[FIRST_TOKEN]

	if (command === BACKLOG_COMMAND) return rebuilt_backlog(tokens)

	if (command === QUEUE_COMMAND) return rebuilt_queue(tokens)

	return undefined
}

// The issues a `queue` invocation declared, in the order it declared them. Anything that is not a
// queue answers `undefined` rather than an empty list: "this invocation has no issue list" and "this
// queue has no issues left" are different facts, and a caller that could not tell them apart would
// report a finished backlogrun as a finished queue.
function issue_numbers(invocation: string): ReadonlyArray<number> | undefined {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== QUEUE_COMMAND) return undefined

	return issues_of(tokens)
}

// **Two entries, because two things call in.** The command words, the flag list and the token helpers
// are this module's own working parts; exporting them would invite a caller to reimplement the
// grammar out of its pieces, which is the clone this module exists to prevent.
const run_invocation = {
	issue_numbers,
	rebuild,
}

export { run_invocation }
