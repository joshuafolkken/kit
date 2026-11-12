import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'

// A Bash line that is one `gh issue <action> <N> …` call and nothing else, which a refusing row can
// rewrite to its `pnpm josh` command (joshuafolkken/kit#7330): every word is plain, so nothing is
// piped, chained, redirected, quoted or expanded, and the one issue number is split from the flags the
// row reads. Shared by `direct-issue-read.ts` and `direct-issue-comment.ts`.

interface StandaloneCall {
	issue: string
	// The words that are not the issue number, joined by one space.
	flags: string
}

const WORD_SEPARATOR = ' '
// A word with no shell syntax in it, so a line of them is one call with nothing chained or redirected.
const PLAIN_WORD = /^[\w./=-]+$/u

function line_of(words: ReadonlyArray<string>): string {
	return words.join(WORD_SEPARATOR)
}

function is_plain_word(word: string): boolean {
	return PLAIN_WORD.test(word)
}

function split_issue(rest: ReadonlyArray<string>): StandaloneCall | undefined {
	const issues = rest.filter((word) => issue_number_shape.is_issue_number(word))
	const [issue] = issues
	const flags = line_of(rest.filter((word) => !issue_number_shape.is_issue_number(word)))

	return issue !== undefined && issues.length === 1 ? { issue, flags } : undefined
}

// The issue and flags after `lead` on a line that is that one call alone, else `undefined`.
function call_of(line: string, lead: ReadonlyArray<string>): StandaloneCall | undefined {
	const words = line.trim().split(WORD_SEPARATOR)
	const is_lead = line_of(words.slice(0, lead.length)) === line_of(lead)

	return is_lead && words.every((word) => is_plain_word(word))
		? split_issue(words.slice(lead.length))
		: undefined
}

// The Bash input with its command replaced by `command_of`'s answer, else `undefined`.
function input_of(
	call: GuardedCall,
	command_of: (command: string) => string | undefined,
): Record<string, unknown> | undefined {
	if (call.name !== cost_blocks.BASH_TOOL || !json_value.is_record(call.input)) return undefined

	const command = command_of(time_shell.bash_command(call.input))

	return command === undefined ? undefined : { ...call.input, command }
}

const standalone_gh_call = { call_of, input_of, is_plain_word, line_of }

export type { StandaloneCall }
export { standalone_gh_call }
