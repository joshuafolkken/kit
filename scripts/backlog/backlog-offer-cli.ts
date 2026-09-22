#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { josh_command } from '#scripts/josh/josh-run'
import { rule_value_cli } from '#scripts/rules/rule-value-cli'
import { run_event_stream } from '#scripts/run/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { backlog_offer, type OfferAnswer } from './backlog-offer'

// `josh backlog:offer` — one composite command for a `backlogrun` loop-head event
// (joshuafolkken/kit#2162). The loop used to spend a turn on `backlog:next` and a second turn feeding
// its answer, translated to a word by hand, into `backlog:budget`; the parent's context is largest
// here, so collapsing the two saves the turn where a turn costs the most — the same reasoning
// `run:merge` collapsed a merge event on.
//
// **The contract matches the path-decided commands': stdout carries the budget verdict on its first
// line**, then — only on `run` — the issue numbers to start, one per line, so a loop reads the branch
// off stdout. The consecutive-retry count for the next ask is on the last stderr line (`retries: <n>`)
// and in the `--json` object; every explanation `backlog:next` and `backlog:budget` print is streamed
// straight through to stderr.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const JSON_KEY = 'offer'
const DEFAULT_COUNT = 0
const RUN_VERDICT = 'run'
// The one budget verdict and mapped answer that name a drain, plus the running count that means the run
// has nothing of its own in flight (joshuafolkken/kit#2335). Read together in `mark_drain`.
const WATCH_VERDICT = 'watch'
const EXHAUSTED_ANSWER = 'exhausted'
const NO_RUNNING = 0
const DRAIN_TEXT = 'backlog drained'
const should_forward_stderr = true
const COUNT_PATTERN = /^\d+$/u

const USAGE =
	'Usage: josh backlog:offer --started <ISO-8601> [--active <ISO-8601>] [--merged <n>] [--running <n>] [--max <n>] [--idle <minutes>] [--retries <n>] [--exclude <n>[,<n>...]]... [--repo <owner/repo>] [--json]'

const OPTIONS = {
	active: { type: 'string' },
	exclude: { type: 'string', multiple: true },
	idle: { type: 'string' },
	json: { type: 'boolean' },
	max: { type: 'string' },
	merged: { type: 'string' },
	repo: { type: 'string' },
	retries: { type: 'string' },
	running: { type: 'string' },
	started: { type: 'string' },
} as const

type OptionName = keyof typeof OPTIONS
type ParsedValues = Partial<Record<OptionName, string | boolean | ReadonlyArray<string>>>

// The flags carried straight to `backlog:budget`; `--answer` is not among them because this command
// computes it. `backlog:budget` validates each one, so a malformed value is refused there.
const FORWARDED = ['started', 'active', 'merged', 'running', 'max', 'idle'] as const

function read_values(argv: ReadonlyArray<string>): ParsedValues | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, strict: true }).values
	} catch {
		return undefined
	}
}

function text_of(value: string | boolean | ReadonlyArray<string> | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function to_count(raw: string | undefined): number | undefined {
	if (raw === undefined || !COUNT_PATTERN.test(raw)) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) ? parsed : undefined
}

// A count flag that was given but unreadable makes the invocation unreadable rather than defaulted —
// the contract `backlog:budget` follows for its own counts.
function count_of(raw: string | undefined, fallback: number): number | undefined {
	return raw === undefined ? fallback : to_count(raw)
}

interface OfferCounts {
	running: number
	retries: number
}

// The two counts the mapping needs: `--running` decides `wait`, `--retries` decides `retry`. Either
// given but unreadable refuses the whole invocation.
function counts_of(values: ParsedValues): OfferCounts | undefined {
	const running = count_of(text_of(values.running), DEFAULT_COUNT)
	const retries = count_of(text_of(values.retries), DEFAULT_COUNT)

	if (running === undefined || retries === undefined) return undefined

	return { running, retries }
}

function excludes_of(values: ParsedValues): ReadonlyArray<string> {
	const raw = values.exclude

	return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
}

function next_argv(values: ParsedValues): ReadonlyArray<string> {
	const repo = text_of(values.repo)

	return [
		'backlog:next',
		...excludes_of(values).flatMap((value) => ['--exclude', value]),
		...(repo === undefined ? [] : ['--repo', repo]),
	]
}

function budget_argv(values: ParsedValues, answer: string): ReadonlyArray<string> {
	const forwarded = FORWARDED.flatMap((name) => {
		const value = text_of(values[name])

		return value === undefined ? [] : [`--${name}`, value]
	})

	return ['backlog:budget', '--answer', answer, ...forwarded]
}

function to_tokens(out: string): ReadonlyArray<string> {
	return out === '' ? [] : out.split('\n')
}

// On `run` the issues to start are the candidates the mapping captured; every other verdict starts
// nothing.
function issues_for(verdict: string, offer: OfferAnswer): ReadonlyArray<string> {
	return verdict === RUN_VERDICT ? offer.issues : []
}

function emit(verdict: string, offer: OfferAnswer, is_json: boolean): number {
	const issues = issues_for(verdict, offer)

	if (is_json) {
		const payload = { verdict, issues, answer: offer.answer, retries: offer.retries }

		console.info(JSON.stringify({ [JSON_KEY]: payload }))

		return SUCCESS_EXIT_CODE
	}

	console.info(verdict)
	for (const issue of issues) console.info(issue)
	console.error(`retries: ${String(offer.retries)}`)

	return SUCCESS_EXIT_CODE
}

function refuse(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

// The drain: the backlog is empty (`exhausted`) and nothing of the run's own is in flight, so the run is
// about to open its idle watch. Marking the stream here — once per drain, which `emit_once` guarantees —
// is what lets `run:step` fire the end-of-run retrospective *before* the watch rather than after it
// (joshuafolkken/kit#2335), so the improvement issues the retrospective files are what the watch then
// picks up. A watch that opened while children were still merging (`running > 0`) is not this drain: the
// retrospective waits for the true idle, and the marker is emitted from the loop head for the same
// reason `run:merge` emits its own events — the command that detects the event owns writing it.
async function mark_drain(verdict: string, answer: string, running: number): Promise<void> {
	if (verdict !== WATCH_VERDICT || answer !== EXHAUSTED_ANSWER || running !== NO_RUNNING) return

	await run_event_stream_emit.emit_once(run_event_stream.EVENT_KIND.DRAIN, DRAIN_TEXT)
}

async function decide(values: ParsedValues, counts: OfferCounts): Promise<number> {
	const next = await josh_command.josh_run(next_argv(values), should_forward_stderr)
	const offer = backlog_offer.answer_of(
		{ code: next.code, tokens: to_tokens(next.out) },
		counts.running,
		counts.retries,
	)
	const budget = await josh_command.josh_run(
		budget_argv(values, offer.answer),
		should_forward_stderr,
	)

	if (budget.code !== SUCCESS_EXIT_CODE) return FAILURE_EXIT_CODE

	await mark_drain(budget.out, offer.answer, counts.running)

	return emit(budget.out, offer, values.json === true)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = read_values(argv)

	if (values === undefined) return refuse()

	// The loop head is the one place `rule:value` is called from: once per iteration, the parent's
	// context still small, so a rule that never fires shows up as a printed row rather than as
	// something a person has to remember to measure (joshuafolkken/kit#2271). It reports to stderr and
	// never fails, so a broken reading never stops the backlog.
	rule_value_cli.emit()

	const counts = counts_of(values)

	if (counts === undefined) return refuse()

	return await decide(values, counts)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_offer_cli = {
	JSON_KEY,
	USAGE,
	budget_argv,
	counts_of,
	emit,
	main,
	next_argv,
	read_values,
	run,
	to_tokens,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_offer_cli }
export type { ParsedValues }
