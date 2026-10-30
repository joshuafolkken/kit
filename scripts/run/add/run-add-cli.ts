#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_added, type CarryAddition } from '#scripts/run/carry/run-carry-added'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_invocation } from '#scripts/run/run-invocation'
import { run_add, type AddContext, type AddOutcome, type AddPorts, type IssueView } from './run-add'

// `josh run:add <issue...> [--no-priority]` — the wiring around `run-add.ts`.
// It refuses unless a `backlogrun` holds the carry record here: an issue labelled with no run to take
// it would be picked up by whichever run starts next, which is not what was asked. A run that named
// issues reads its list off the record — with `--only` or without, since a named run drains the pool
// only after that list — so the queued issues are written there too; a pool run reads the labels alone. Each queued issue is announced as an `add` event, which wakes a `run:progress --wait` parked
// on a full house so the parent offers it the next freed lane.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE_EXIT_CODE = 2
const ARGV_OFFSET = 2
const ISSUE_PREFIX = '#'
const NO_PRIORITY_FLAG = '--no-priority'
const RETRY_FLAG = '--retry'
const RETRY_FAILED = 'Could not record the retry boundary.'
const USAGE = `Usage: josh run:add <issue...> [${NO_PRIORITY_FLAG}] [${RETRY_FLAG}]`
const NO_RUN_MESSAGE =
	'No backlogrun is running here, so nothing was added. Start one with `backlogrun #N`.'

interface AddRequest {
	issues: ReadonlyArray<number>
	is_priority: boolean
	is_retry: boolean
}

interface LiveRun {
	target: string
	carry: RunCarry
}

function parse_issue(token: string): number | undefined {
	const digits = token.startsWith(ISSUE_PREFIX) ? token.slice(ISSUE_PREFIX.length) : token

	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(digits) ? Number(digits) : undefined
}

// Every token but the flag must be an issue number: a typo is refused whole rather than adding the
// rest, so the queue never holds half of what was typed.
function parse_request(argv: ReadonlyArray<string>): AddRequest | undefined {
	const tokens = argv.filter((token) => token !== NO_PRIORITY_FLAG && token !== RETRY_FLAG)
	const issues = tokens.map((token) => parse_issue(token)).filter((issue) => issue !== undefined)

	if (issues.length === 0 || issues.length !== tokens.length) return undefined

	return {
		issues: [...new Set(issues)],
		is_priority: !argv.includes(NO_PRIORITY_FLAG),
		is_retry: argv.includes(RETRY_FLAG),
	}
}

async function live_run(): Promise<LiveRun | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	const target = run_carry.carry_path(directory)
	const read = run_carry.read_carry(target)

	return read.kind === 'carried' ? { target, carry: read.carry } : undefined
}

// Re-read rather than reusing the record found before the labels were written: the parent may have
// marked an issue done in between, and writing the stale copy back would undo that.
function record(target: string, additions: ReadonlyArray<CarryAddition>, is_retry: boolean): void {
	const read = run_carry.read_carry(target)

	if (read.kind !== 'carried') {
		throw new Error('The backlogrun record disappeared; nothing was queued.')
	}

	const is_named = run_invocation.issue_numbers(read.carry.invocation) !== undefined
	const retries = is_retry ? additions.map((addition) => addition.issue) : []

	run_carry_added.add_issues(target, read.carry, is_named ? additions : [], retries)
}

async function announce_retry(issue: number): Promise<void> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) throw new Error(RETRY_FAILED)

	const result = await run_event_stream_emit.append_at(
		target,
		run_event_stream.EVENT_KIND.ADD,
		run_event_retry.text_of(issue),
		new Date(),
	)

	if (!result.appended) throw new Error(RETRY_FAILED)
}

async function announce(issues: ReadonlyArray<number>, is_retry: boolean): Promise<void> {
	const [issue, ...rest] = issues

	if (issue === undefined) return

	if (is_retry) await announce_retry(issue)
	else {
		await run_event_stream_emit.emit(
			run_event_stream.EVENT_KIND.ADD,
			`added ${ISSUE_PREFIX}${String(issue)}`,
		)
	}

	await announce(rest, is_retry)
}

// The blockers still open. A blocker whose state did not come back counts as open, so an issue is
// never reported free to run on a read that did not say so.
function view_of(json: string): IssueView | undefined {
	const issue = epic_issue.parse_epic_issue(json)

	if (issue === undefined) return undefined

	const blockers = (issue.blockedBy?.nodes ?? [])
		.filter((blocker) => epic_issue.normalize_state(blocker.state ?? '') !== epic_issue.CLOSED)
		.map((blocker) => blocker.number)

	return {
		is_open: epic_issue.is_open(issue.state),
		blockers,
		labels: epic_issue.label_names(issue),
	}
}

async function read_issue(issue: number): Promise<IssueView | undefined> {
	const read = await git_gh_command.issue_get_state_and_relations_classified(String(issue))

	return read.kind === 'read' ? view_of(read.json) : undefined
}

async function apply_label(issue: number, label: string): Promise<boolean> {
	return await git_gh_command.issue_add_label(String(issue), label)
}

async function clear_label(issue: number, label: string): Promise<boolean> {
	return await git_gh_command.issue_clear_label(String(issue), label)
}

const GH_PORTS: AddPorts = { read_issue, apply_label, clear_label }

async function context_of(live: LiveRun, is_retry: boolean): Promise<AddContext> {
	const lanes = await lane_spent.lanes_in_use()
	const events = await run_event_stream_emit.current_events()
	const active = backlog_drive_restore.active_issues(events)
	const terminal = events.filter((event) => event.kind !== run_event_stream.EVENT_KIND.PARK)

	return {
		is_retry,
		done: live.carry.done ?? [],
		active: new Set([...active, ...lanes.working, ...lanes.unread]),
		settled: new Set([
			...(live.carry.merged_issues ?? []),
			...backlog_drive_restore.settled_issues(terminal),
		]),
	}
}

function report(outcomes: ReadonlyArray<AddOutcome>, is_priority: boolean): number {
	for (const outcome of outcomes) console.info(run_add.describe(outcome, is_priority))

	return run_add.is_all_queued(outcomes) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function add(request: AddRequest, live: LiveRun, ports: AddPorts): Promise<number> {
	const outcomes: ReadonlyArray<AddOutcome> = await run_add.add_all(
		request.issues,
		request.is_priority,
		ports,
		await context_of(live, request.is_retry),
	)
	const additions = run_add.additions_of(outcomes, request.is_priority)

	if (additions.length === 0) return report(outcomes, request.is_priority)

	await announce(
		additions.map((addition) => addition.issue),
		request.is_retry,
	)
	record(live.target, additions, request.is_retry)

	return report(outcomes, request.is_priority)
}

async function run(argv: ReadonlyArray<string>, ports: AddPorts = GH_PORTS): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return USAGE_EXIT_CODE
	}

	const live = await live_run()

	if (live === undefined) {
		console.error(NO_RUN_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return await add(request, live, ports)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_add_cli = { NO_RUN_MESSAGE, USAGE, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_add_cli }
