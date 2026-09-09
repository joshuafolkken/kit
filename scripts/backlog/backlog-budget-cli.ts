#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { path_decision } from '#scripts/josh/path-decision'
import { backlog_budget, type BacklogAnswer, type BudgetInput } from './backlog-budget'

// The thin half of `josh backlog:budget` (joshuafolkken/kit#1632): read the loop's state off the
// command line, hand it to the pure decision, print the verdict on stdout and the reason on stderr
// through the printer every mechanically-decided command in this repository already shares.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const JSON_KEY = 'budget'

const USAGE = `Usage: josh backlog:budget --answer <${backlog_budget.ANSWERS.join('|')}> --started <ISO-8601> [--active <ISO-8601>] [--merged <count>] [--running <count>] [--max <count>] [--idle <minutes> --active <ISO-8601>] [--json]`

const OPTIONS = {
	active: { type: 'string' },
	answer: { type: 'string' },
	idle: { type: 'string' },
	json: { type: 'boolean' },
	max: { type: 'string' },
	merged: { type: 'string' },
	running: { type: 'string' },
	started: { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS
type ParsedValues = Partial<Record<OptionName, string | boolean>>

// A misspelled flag is refused rather than defaulted, the contract `path_decision.has_unknown_flag`
// states for the path-decided commands: an invocation nobody can read is never answered.
function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, strict: true }).values
	} catch {
		return undefined
	}
}

function text_of(value: string | boolean | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined
}

// `find` rather than a cast: an unrecognized word has to be refused, and a type assertion would
// carry it into the decision as a fifth answer nothing branches on.
function to_answer(raw: string | undefined): BacklogAnswer | undefined {
	return backlog_budget.ANSWERS.find((answer) => answer === raw)
}

function to_time_ms(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined

	const parsed = Date.parse(raw)

	return Number.isNaN(parsed) ? undefined : parsed
}

// Digits and nothing else. `Number('')`, `Number(' ')` and `Number('0x10')` are all safe integers, so
// a check that only asked `Number.isSafeInteger` would read an unset shell variable — `--max
// "$max_issues"` — as a maximum of zero and finish the run having done nothing.
const COUNT_PATTERN = /^\d+$/u

function to_count(raw: string | undefined): number | undefined {
	if (raw === undefined || !COUNT_PATTERN.test(raw)) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) ? parsed : undefined
}

// A flag that was given but could not be read makes the whole invocation unreadable. Falling back to
// the default instead would answer a question nobody asked — a mistyped `--idle` would read as "no
// idle watch" and end the run at the first empty backlog.
function is_readable(raw: string | undefined, parsed: number | undefined): boolean {
	return raw === undefined || parsed !== undefined
}

const COUNT_NAMES = ['idle', 'max', 'merged', 'running'] as const

type Counts = Record<(typeof COUNT_NAMES)[number], number | undefined>

function counts_of(values: ParsedValues): Counts {
	return {
		idle: to_count(text_of(values.idle)),
		max: to_count(text_of(values.max)),
		merged: to_count(text_of(values.merged)),
		running: to_count(text_of(values.running)),
	}
}

function are_counts_readable(values: ParsedValues, counts: Counts): boolean {
	return COUNT_NAMES.every((name) => is_readable(text_of(values[name]), counts[name]))
}

function to_idle_ms(idle_minutes: number | undefined): number | undefined {
	return idle_minutes === undefined ? undefined : idle_minutes * backlog_budget.MS_PER_MINUTE
}

// An idle watch measured from the run's start is not the watch that was asked for. A run already
// working for longer than the budget would answer `stop` on its very first empty backlog, printing
// that the backlog "stayed empty for the whole watch" — an emptiness it never saw. So `--idle`
// without `--active` is an unreadable invocation rather than a defaulted one.
function is_watch_readable(values: ParsedValues): boolean {
	return text_of(values.idle) === undefined || text_of(values.active) !== undefined
}

function are_values_readable(values: ParsedValues): boolean {
	return (
		is_readable(text_of(values.active), to_time_ms(text_of(values.active))) &&
		is_watch_readable(values) &&
		are_counts_readable(values, counts_of(values))
	)
}

// What the two required flags carry, once they have been read. Split out so the assembly below can
// take the defaults without the refusals above sharing its complexity budget.
type InputBase = Pick<BudgetInput, 'answer' | 'now_ms' | 'started_at_ms'>

function input_of(values: ParsedValues, base: InputBase): BudgetInput {
	const counts = counts_of(values)

	return {
		...base,
		active_at_ms: to_time_ms(text_of(values.active)) ?? base.started_at_ms,
		merged: counts.merged ?? 0,
		running: counts.running ?? 0,
		max_issues: counts.max,
		idle_budget_ms: to_idle_ms(counts.idle),
	}
}

function build_input(values: ParsedValues, now_ms: number): BudgetInput | undefined {
	const answer = to_answer(text_of(values.answer))

	if (answer === undefined) return undefined

	const started_at_ms = to_time_ms(text_of(values.started))

	if (started_at_ms === undefined) return undefined
	if (!are_values_readable(values)) return undefined

	return input_of(values, { answer, now_ms, started_at_ms })
}

function refuse(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

function run(argv: ReadonlyArray<string>, now_ms: number = Date.now()): number {
	const values = read_arguments(argv)

	if (values === undefined) return refuse()

	const input = build_input(values, now_ms)

	if (input === undefined) return refuse()

	const { verdict, reason } = backlog_budget.decide(input)

	path_decision.print_decision(JSON_KEY, verdict, reason, values.json === true)

	return SUCCESS_EXIT_CODE
}

// `process.exitCode` rather than `process.exit()`, for the reason `backlog:next` records: the whole
// contract is `answer=$(pnpm josh backlog:budget …)`, and exiting outright can cut the pipe before it
// has drained.
function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const backlog_budget_cli = {
	JSON_KEY,
	OPTIONS,
	SUCCESS_EXIT_CODE,
	USAGE,
	build_input,
	main,
	read_arguments,
	run,
	to_answer,
	to_count,
	to_time_ms,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { backlog_budget_cli }
export type { ParsedValues }
