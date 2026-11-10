#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import type { PriorityLevel } from './issue-priority'
import { issue_priority_instructed, type InstructedResult } from './issue-priority-instructed'
import { issue_priority_raise, type RaiseResult } from './issue-priority-raise'

// `josh issue:priority <N>` — raise an open issue to the priority its body declares or reaches after
// filing, as a recurrence's appended cause-loss line does (joshuafolkken/kit#4960, joshuafolkken/kit#6757).
// `--critical|--high|--normal --reason <text>` applies a person's instruction instead, raising or
// lowering whatever the body declares (joshuafolkken/kit#6758, joshuafolkken/kit#7000). Either way the
// issue keeps one priority label.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh issue:priority <issue-number> [--critical|--high|--normal --reason <text>]'

const OPTIONS = {
	critical: { type: 'boolean' },
	high: { type: 'boolean' },
	normal: { type: 'boolean' },
	reason: { type: 'string' },
} as const

const LEVEL_FLAGS: ReadonlyArray<PriorityLevel> = ['critical', 'high', 'normal']

const REPORTS: Readonly<Record<RaiseResult, string>> = {
	raised: 'applied the priority label its body declares or reaches.',
	labelled: 'already carries a priority label at its level — left as it is.',
	below: 'stays at normal priority — no label applied.',
	unreadable: 'could not be read — no label applied.',
	failed: 'ranks above its labels, but applying the priority label failed.',
}

const INSTRUCTED_REPORTS: Readonly<Record<InstructedResult, string>> = {
	raised: 'took the instructed priority and commented the instruction behind it',
	labelled: 'already carries the instructed priority — left as it is, no comment',
	unreadable: 'could not be read — the instructed priority not applied',
	failed: 'changing to the instructed priority or commenting the instruction behind it failed',
}

// A person's instruction: the level its flag names and the reason it gives.
interface Instruction {
	level: PriorityLevel
	reason: string
}

// The issue and the instruction; `instruction` is `undefined` for the body-declared raise.
interface PriorityRequest {
	issue_number: string
	instruction: Instruction | undefined
}

interface PriorityValues {
	critical?: boolean
	high?: boolean
	normal?: boolean
	reason?: string
}

function parse_number(positionals: ReadonlyArray<string>): string | undefined {
	const [first] = positionals

	if (first === undefined || positionals.length !== 1) return undefined

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(first) ? first : undefined
}

function levels_of(values: PriorityValues): ReadonlyArray<PriorityLevel> {
	return LEVEL_FLAGS.filter((level) => values[level] === true)
}

// At most one level flag, which needs a non-blank `--reason`; `--reason` means nothing without one.
function is_consistent(values: PriorityValues): boolean {
	const count = levels_of(values).length

	if (count === 0) return values.reason === undefined

	return count === 1 && (values.reason?.trim() ?? '') !== ''
}

// The instruction a consistent set of flags carries; `undefined` for the body-declared raise.
function instruction_of(values: PriorityValues): Instruction | undefined {
	const [level] = levels_of(values)
	const { reason } = values

	return level === undefined || reason === undefined ? undefined : { level, reason }
}

function parse_request(argv: ReadonlyArray<string>): PriorityRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined || !is_consistent(parsed.values)) return undefined
	const issue_number = parse_number(parsed.positionals)

	if (issue_number === undefined) return undefined

	return { issue_number, instruction: instruction_of(parsed.values) }
}

async function apply(request: PriorityRequest): Promise<{ result: RaiseResult; text: string }> {
	const { issue_number, instruction } = request

	if (instruction === undefined) {
		const result = await issue_priority_raise.raise(issue_number)

		return { result, text: REPORTS[result] }
	}

	const { level, reason } = instruction
	const result = await issue_priority_instructed.apply(issue_number, level, reason)

	return { result, text: `${INSTRUCTED_REPORTS[result]} (--${level}).` }
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const { result, text } = await apply(request)
	const line = `Issue ${session_cite.issue(request.issue_number)} ${text}`
	const is_failure = issue_priority_raise.is_failure(result)

	if (is_failure) console.error(line)
	else console.info(line)

	return is_failure ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_priority_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_priority_cli }
