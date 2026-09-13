import { cost_blocks } from '#scripts/cost/cost-blocks'
import type { GuardedCall } from '#scripts/time/time-batch-guard'
import { time_shell } from '#scripts/time/time-shell'
import { time_transcript_line, type Block } from '#scripts/time/time-transcript-line'

// The stand-down that keeps the `issue-comments` rule from refusing a body read the run has already
// earned (joshuafolkken/kit#1905). The rule exists so a run reads an Issue's comments before building
// on its body — but a run that already read them, and later reads the body again (a post-merge state
// check, a re-read), was refused a second time for a read it had already made. **The delivery path
// sees only the raw transcript tail** — `delivered-rules.ts` names the reason the run's own calls are
// not handed to it — so the earlier read is recovered by parsing that tail here, the same way
// `time-batch-guard.ts` parses it, rather than from a call array that does not reach delivery.
//
// **It reads comments in the josh spelling too.** `pnpm josh issue:read <N>` prints the body and every
// comment in one call, so a run that opened an Issue with it has read the comments as surely as one
// that passed `--comments` — and that spelling is the one the workflow itself reaches for, so leaving
// it out would refuse the reader that obeyed the rule most directly.

// The path segment `…/issues/<N>` and `…/issues/<N>/comments` both name the Issue in the same capture.
const ISSUE_PATH_NUMBER = /issues\/(\d+)/gu
// The positional after `gh issue view`, past any flags that precede it.
const ISSUE_VIEW_NUMBER = /\bissue\s+view\s+(?:-{1,2}\S+\s+)*(\d+)/u
// The run of numbers `pnpm josh issue:read` takes as its positional arguments.
const ISSUE_READ_ARGUMENTS = /\bissue:read\b([\s\d]*)/u
const A_NUMBER = /^\d+$/u

// A command that prints an Issue's comments: the comments endpoint, `gh issue view … --comments`, or
// the josh command that reads body and comments together.
const COMMENTS_ENDPOINT = /issues\/\d+\/comments\b/u
const VIEW_WITH_COMMENTS = /\bissue\s+view\b[^\n]*--comments\b/u
const ISSUE_READ_COMMAND = /\bissue:read\b/u

function add_issue_read_numbers(command: string, numbers: Set<number>): void {
	const match = ISSUE_READ_ARGUMENTS.exec(command)

	if (match === null) return

	const tokens = (match[1] ?? '').split(/\s+/u)

	for (const token of tokens) {
		if (A_NUMBER.test(token)) numbers.add(Number(token))
	}
}

// Every Issue number a command names, across the three read spellings the refusal covers.
function issue_numbers_of(command: string): Set<number> {
	const numbers = new Set<number>()

	for (const match of command.matchAll(ISSUE_PATH_NUMBER)) numbers.add(Number(match[1]))

	const view = ISSUE_VIEW_NUMBER.exec(command)

	if (view !== null) numbers.add(Number(view[1]))

	add_issue_read_numbers(command, numbers)

	return numbers
}

function fetches_comments(command: string): boolean {
	return (
		COMMENTS_ENDPOINT.test(command) ||
		VIEW_WITH_COMMENTS.test(command) ||
		ISSUE_READ_COMMAND.test(command)
	)
}

function reads_target_comments(command: string, target: Set<number>): boolean {
	if (!fetches_comments(command)) return false

	for (const number of issue_numbers_of(command)) {
		if (target.has(number)) return true
	}

	return false
}

function is_bash_call(block: Block): boolean {
	return block.type === cost_blocks.TOOL_USE_TYPE && block.name === cost_blocks.BASH_TOOL
}

// The Bash commands one transcript line issued, empty for a line that parses to none.
function bash_commands_of(line: string): ReadonlyArray<string> {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed === undefined) return []

	return parsed.blocks
		.filter((block) => is_bash_call(block))
		.map((block) => time_shell.bash_command(block.input))
}

function prior_commands(tail: string): ReadonlyArray<string> {
	return tail.split('\n').flatMap((line) => bash_commands_of(line))
}

// **Whether the run has already read the comments of the Issue this body read targets.** The tail is
// scanned for a prior read of the same number, so a body read that names no Issue — and a run with no
// earlier comment read — both answer false and are refused exactly as before.
function already_read_comments_for(tail: string, command: string): boolean {
	const target = issue_numbers_of(command)

	if (target.size === 0) return false

	return prior_commands(tail).some((prior) => reads_target_comments(prior, target))
}

// The `already_satisfied` predicate wired onto the issue-comments row of `delivered-rules.ts`: this
// call's command against the tail, once the same tool-name gate `on_bash_command` applies has passed.
function already_read_for_call(tail: string, call: GuardedCall): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	return already_read_comments_for(tail, time_shell.bash_command(call.input))
}

const prior_comment_read = {
	already_read_comments_for,
	already_read_for_call,
	fetches_comments,
	issue_numbers_of,
}

export { prior_comment_read }
