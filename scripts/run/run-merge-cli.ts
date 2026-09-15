#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { run_carry, type CarryOwner } from './run-carry'
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
const STOP_TOKEN = 'stop'
const RETRY_TOKEN = 'retry'
// The same digit shape `run-carry-args.ts` reads an owner pid under; a count is a bare run of digits.
const DIGITS = /^\d+$/u
const USAGE =
	'Usage: josh run:merge <issue> --over <tokens> [--epic <E> --repo <owner/repo>] [--owner <pid>]'

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

function to_over(raw: string | undefined): number | undefined {
	if (raw === undefined || !DIGITS.test(raw)) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) ? parsed : undefined
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

function valid_child(parsed: ParsedArguments): string | undefined {
	const child = parsed.positionals[FIRST]

	if (child === undefined) return undefined

	return run_issue_number.ISSUE_NUMBER_PATTERN.test(child) ? child : undefined
}

function to_context(parsed: ParsedArguments): MergeContext | undefined {
	if (is_epic_without_repo(parsed.values)) return undefined

	const child = valid_child(parsed)

	if (child === undefined) return undefined

	const over = to_over(parsed.values.over)
	const owner = to_owner(parsed.values.owner)

	if (over === undefined || owner === undefined) return undefined

	return { child, epic: parsed.values.epic, repo: parsed.values.repo, over, owner }
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

// A merge is the only outcome that asks the hand-off check, because it is the only one that returned
// the tree to a clean default branch. `over` stops the offer; `under` asks for the next child.
async function on_merged(ctx: MergeContext): Promise<number> {
	await run_merge_steps.do_merged(ctx)

	if (await run_merge_steps.is_over_budget(ctx.over)) return emit(OVER_TOKEN, SUCCESS_EXIT_CODE)

	return emit(await run_merge_steps.ask_next(ctx), SUCCESS_EXIT_CODE)
}

async function on_failed(ctx: MergeContext): Promise<number> {
	const carry = await run_merge_steps.do_failed(ctx)

	if (carry !== undefined && run_merge.is_guard_tripped(carry.failures)) {
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
