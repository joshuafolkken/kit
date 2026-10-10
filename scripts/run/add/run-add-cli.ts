#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_added, type CarryAddition } from '#scripts/run/carry/run-carry-added'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_invocation } from '#scripts/run/run-invocation'
import { run_add, type AddOutcome, type AddPorts, type IssueView } from './run-add'

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
const USAGE = `Usage: josh run:add <issue...> [${NO_PRIORITY_FLAG}]`
const NO_RUN_MESSAGE =
	'No backlogrun is running here, so nothing was added. Start one with `backlogrun #N`.'

interface AddRequest {
	issues: ReadonlyArray<number>
	is_priority: boolean
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
	const tokens = argv.filter((token) => token !== NO_PRIORITY_FLAG)
	const issues = tokens.map((token) => parse_issue(token)).filter((issue) => issue !== undefined)

	if (issues.length === 0 || issues.length !== tokens.length) return undefined

	return { issues, is_priority: !argv.includes(NO_PRIORITY_FLAG) }
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
function record(target: string, additions: ReadonlyArray<CarryAddition>): void {
	const read = run_carry.read_carry(target)

	if (
		read.kind !== 'carried' ||
		run_invocation.issue_numbers(read.carry.invocation) === undefined
	) {
		return
	}

	if (additions.length > 0) run_carry_added.add_issues(target, read.carry, additions)
}

async function announce(issues: ReadonlyArray<number>): Promise<void> {
	const [issue, ...rest] = issues

	if (issue === undefined) return

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.ADD,
		`added ${ISSUE_PREFIX}${String(issue)}`,
	)
	await announce(rest)
}

// The blockers still open. A blocker whose state did not come back counts as open, so an issue is
// never reported free to run on a read that did not say so.
function view_of(json: string): IssueView | undefined {
	const issue = epic_issue.parse_epic_issue(json)

	if (issue === undefined) return undefined

	const blockers = (issue.blockedBy?.nodes ?? [])
		.filter((blocker) => epic_issue.normalize_state(blocker.state ?? '') !== epic_issue.CLOSED)
		.map((blocker) => blocker.number)

	return { is_open: epic_issue.is_open(issue.state), blockers }
}

async function read_issue(issue: number): Promise<IssueView | undefined> {
	const read = await git_gh_command.issue_get_state_and_relations_classified(String(issue))

	return read.kind === 'read' ? view_of(read.json) : undefined
}

async function apply_label(issue: number, label: string): Promise<boolean> {
	return await git_gh_command.issue_add_label(String(issue), label)
}

const GH_PORTS: AddPorts = { read_issue, apply_label }

async function add(request: AddRequest, target: string, ports: AddPorts): Promise<number> {
	const outcomes: ReadonlyArray<AddOutcome> = await run_add.add_all(
		request.issues,
		request.is_priority,
		ports,
	)
	const additions = run_add.additions_of(outcomes, request.is_priority)

	record(target, additions)
	await announce(additions.map((addition) => addition.issue))

	for (const outcome of outcomes) console.info(run_add.describe(outcome, request.is_priority))

	return run_add.is_all_queued(outcomes) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
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

	return await add(request, live.target, ports)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_add_cli = { NO_RUN_MESSAGE, USAGE, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_add_cli }
