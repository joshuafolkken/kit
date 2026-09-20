#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { run_carry, type CarryOwner, type RunCarry } from './run-carry'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'
import { run_issue_number } from './run-issue-number'
import { run_merge, type ChildOutcome } from './run-merge'
import { run_merge_steps, type MergeContext } from './run-merge-steps'

// `josh run:merge <N>` — one composite command for a `backlogrun` merge event (joshuafolkken/kit#2024).
// The parent's context is the largest and its per-turn cost the highest, and the event was two turns:
// a reading turn and an acting turn. This collapses them — the parent calls this once at a child's
// return and reads back the next child number, or a control verdict.
//
// The contract is `run:carry`'s: **standard output carries one token** (or the newline-separated
// offer `epic:next --lanes` prints), and everything else is a captured subprocess or a quiet
// in-process call. The verdicts this command adds to the offer are `over` (hand off), `human-review`
// (stop — the child's own ending), `stop` (the consecutive-failure guard tripped) and `retry` (the
// child's state could not be read; re-read before deciding).

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const FIRST = 0
const MIN_PID = 1
const OVER_TOKEN = 'over'
const HUMAN_REVIEW_TOKEN = 'human-review'
// Matches the `busy` verdict `run:carry` emits for a refused count, so callers see one vocabulary.
const BUSY_TOKEN = 'busy'
const STOP_TOKEN = 'stop'
const RETRY_TOKEN = 'retry'
const PARK_FAILURE_NOTE = 'The failed child could not be parked with needs-decision; stopping.'
// The same digit shape `run-carry-args.ts` reads an owner pid under; a count is a bare run of digits.
const DIGITS = /^\d+$/u
// A GitHub `owner/repo` slug: an owner and a repository name around a single slash, each starting with
// an alphanumeric so neither half can begin with `-`. `epic` and `repo` flow into `pnpm josh`
// subprocess arguments, so a value shaped like an option (`--foo`, or `--evil/x`) would be read as a
// flag rather than a value — argument injection (Sonar S8705). The leading-alphanumeric anchor is what
// makes the pattern an *effective* sanitizer: a looser `[\w.-]+` still admits `--evil/x`, which GitHub
// itself forbids (names cannot start with a hyphen) and which the taint analyzer keeps flagging.
const REPO_PATTERN = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u
const USAGE =
	'Usage: josh run:merge <issue> [--over <deprecated>] [--epic <E> --repo <owner/repo>] [--owner <pid>]'

const OPTIONS = {
	epic: { type: 'string' },
	over: { type: 'string' },
	owner: { type: 'string' },
	repo: { type: 'string' },
} as const

interface ParsedArguments {
	positionals: ReadonlyArray<string>
	values: Partial<Record<'epic' | 'over' | 'owner' | 'repo', string>>
}

function read_args(argv: ReadonlyArray<string>): ParsedArguments | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
	} catch {
		return undefined
	}
}

// Absent owner is "no owner declared", which the carry guard reads as not provably foreign; a present
// but malformed pid invalidates the invocation rather than silently counting unguarded.
function to_owner(raw: string | undefined): CarryOwner | undefined {
	if (raw === undefined) return run_carry.NO_OWNER

	if (!DIGITS.test(raw)) return undefined

	const pid = Number(raw)

	return pid < MIN_PID ? undefined : run_carry.owner_of(pid)
}

// The epic form needs a repository (`epic:next --lanes` refuses without one), so an epic named with
// no repository is a usage error rather than a silent fall-through to the backlog offer.
function is_epic_without_repo(values: ParsedArguments['values']): boolean {
	return values.epic !== undefined && values.repo === undefined
}

// Returns a present epic only when it is an issue number, so the string that reaches a subprocess
// argument passes a recognized regex sanitizer in the same expression (Sonar S8705). The named pattern
// is tested directly rather than passed in, because the taint analyzer credits a literal pattern test
// as a sanitizer — exactly as `valid_child` does — but not one reached through a parameter.
function valid_epic(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined

	return run_issue_number.ISSUE_NUMBER_PATTERN.test(raw) ? raw : undefined
}

// The repository counterpart, testing its own named pattern directly for the same reason.
function valid_repo(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined

	return REPO_PATTERN.test(raw) ? raw : undefined
}

// A value that was present but failed its shape check: `valid_epic` / `valid_repo` map it to
// `undefined`, and it was not absent to begin with. An absent value is left to `is_epic_without_repo`
// and the backlog fall-through, so `undefined` is not a rejection.
function is_rejected(raw: string | undefined, valid: string | undefined): boolean {
	return raw !== undefined && valid === undefined
}

// The offer arguments that must hold before a context is built: an epic needs its repository, and
// neither may be shaped like a subprocess flag (`valid_epic` / `valid_repo` reject that). Grouped here
// so `to_context` reads them as one precondition rather than as separate branches.
function has_invalid_offer(values: ParsedArguments['values']): boolean {
	return (
		is_epic_without_repo(values) ||
		is_rejected(values.epic, valid_epic(values.epic)) ||
		is_rejected(values.repo, valid_repo(values.repo))
	)
}

// Old parents may still pass the numeric threshold they started with. Its shape remains strict, but
// its value is ignored so an in-flight caller cannot restore a second threshold source.
function has_invalid_legacy_over(raw: string | undefined): boolean {
	if (raw === undefined) return false

	return !DIGITS.test(raw) || !Number.isSafeInteger(Number(raw))
}

function valid_child(parsed: ParsedArguments): string | undefined {
	const child = parsed.positionals[FIRST]

	if (child === undefined) return undefined

	return run_issue_number.ISSUE_NUMBER_PATTERN.test(child) ? child : undefined
}

function to_context(parsed: ParsedArguments): MergeContext | undefined {
	if (has_invalid_offer(parsed.values) || has_invalid_legacy_over(parsed.values.over)) {
		return undefined
	}

	const child = valid_child(parsed)

	if (child === undefined) return undefined

	const owner = to_owner(parsed.values.owner)

	if (owner === undefined) return undefined

	return {
		child,
		epic: valid_epic(parsed.values.epic),
		repo: valid_repo(parsed.values.repo),
		over: CONTEXT_CUT_THRESHOLD,
		owner,
	}
}

function parse(argv: ReadonlyArray<string>): MergeContext | undefined {
	const parsed = read_args(argv)

	return parsed === undefined ? undefined : to_context(parsed)
}

function emit(token: string, code: number): number {
	console.info(token)

	return code
}

function outcome_of(read: Awaited<ReturnType<typeof issue_state_cli.read_issue>>): ChildOutcome {
	return read.kind === 'state' ? run_merge.classify_child(read.state) : 'unresolved'
}

// A refused count means this session is not the carry record's owner, so the whole operation is
// rejected — the lane is not closed and no next child is offered (joshuafolkken/kit#2114).
function report_count_refused(carry: RunCarry | undefined): number {
	if (carry !== undefined) console.error(run_carry.count_refused_message(carry))

	return emit(BUSY_TOKEN, FAILURE_EXIT_CODE)
}

// A merge is the only outcome that asks the hand-off check, because it is the only one that returned
// the tree to a clean default branch. `over` stops the offer; `under` asks for the next child.
async function on_merged(ctx: MergeContext): Promise<number> {
	const refused = await run_merge_steps.do_merged(ctx)

	if (refused !== undefined) return report_count_refused(refused)

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.MERGE, `#${ctx.child} merged`)

	if (await run_merge_steps.is_over_budget(ctx.over)) return emit(OVER_TOKEN, SUCCESS_EXIT_CODE)

	return emit(await run_merge_steps.ask_next(ctx), SUCCESS_EXIT_CODE)
}

async function on_failed(ctx: MergeContext): Promise<number> {
	const result = await run_merge_steps.do_failed(ctx)

	if (result.is_refused) return report_count_refused(result.carry)

	if (!result.is_parked) {
		console.error(PARK_FAILURE_NOTE)

		return emit(STOP_TOKEN, FAILURE_EXIT_CODE)
	}

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.PARK,
		`#${ctx.child} parked (needs-decision)`,
	)

	if (result.carry !== undefined && run_merge.is_guard_tripped(result.carry.failures)) {
		return emit(STOP_TOKEN, SUCCESS_EXIT_CODE)
	}

	return emit(await run_merge_steps.ask_next(ctx), SUCCESS_EXIT_CODE)
}

async function on_parked(ctx: MergeContext): Promise<number> {
	return emit(await run_merge_steps.ask_next(ctx), SUCCESS_EXIT_CODE)
}

// The child's own ending: it stopped before its commit for a person to look at, so nothing is counted
// and no next child is offered.
async function on_human_review(): Promise<number> {
	return emit(HUMAN_REVIEW_TOKEN, SUCCESS_EXIT_CODE)
}

// The state could not be read, which is never `OPEN`: re-read before deciding anything.
async function on_unresolved(): Promise<number> {
	return emit(RETRY_TOKEN, FAILURE_EXIT_CODE)
}

const HANDLERS: Readonly<Record<ChildOutcome, (ctx: MergeContext) => Promise<number>>> = {
	failed: on_failed,
	'human-review': on_human_review,
	merged: on_merged,
	parked: on_parked,
	unresolved: on_unresolved,
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const ctx = parse(argv)

	if (ctx === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const read = await issue_state_cli.read_issue(ctx.child, ctx.repo)

	return await HANDLERS[outcome_of(read)](ctx)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_merge_cli = {
	BUSY_TOKEN,
	HUMAN_REVIEW_TOKEN,
	OVER_TOKEN,
	RETRY_TOKEN,
	STOP_TOKEN,
	USAGE,
	main,
	parse,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_merge_cli }
