#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { has_any_label, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { poll, type PollOptions } from '#scripts/lib/poll'
import { lane_plan, type LanePlan } from './lane-plan'

// `josh lane:plan <issue> <path>...` — record the files a lane child plans to edit, then wait until no
// running lane that planned earlier declares or plans one of them (joshuafolkken/kit#4864).
//
// **The wait happens before the first edit**, so a conflict the bodies did not show is met while the
// later lane has nothing to throw away, not at its ship. It ends `clear` once the holder's lane ends,
// or `wait` after the polls run out — inside one ten-minute tool call — and the lane runs it again.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh lane:plan <issue-number> <path> [<path> ...]'
const RUNNING = new Set([IN_PROGRESS_LABEL])
const WAIT_POLL: PollOptions = { attempts: 18, interval_ms: 30_000 }

interface Watch {
	plan: LanePlan
	directory: string
	note?: string | undefined
}

function plan_of(argv: ReadonlyArray<string>, now: Date): LanePlan | undefined {
	const [issue = '', ...paths] = argv

	const claims = [...backlog_overlap.path_claims(paths)]

	if (!issue_number_shape.is_issue_number(issue) || claims.length === 0) return undefined

	return { issue: Number(issue), paths: claims, planned_at: now.toISOString() }
}

// The running lanes carry the pickup label, so the opted-in listing holds their bodies.
async function running_issues(): Promise<ReadonlyArray<OpenIssueData> | undefined> {
	const read = await auto_ok_cli.fetch_opted_in()

	if (read.kind !== 'read') return undefined

	return read.issues.filter((issue) => has_any_label(issue.labels, RUNNING))
}

function clash_among(watch: Watch, issues: ReadonlyArray<OpenIssueData>): Clash | undefined {
	const { plan, directory } = watch
	const declared = lane_plan.with_plans(backlog_overlap.declared_of(issues), directory)
	const numbers = issues.map((issue) => issue.number)
	const holders = lane_plan.earlier_holders(plan, numbers, directory)

	return backlog_overlap.path_clash(new Set(plan.paths), declared, holders)
}

function clash_note(issue: number, clash: Clash): string {
	const holder = session_cite.issue(clash.holder)

	return `${session_cite.issue(issue)} waits before implementing: its planned \`${clash.path}\` overlaps \`${clash.claimed}\`, which ${holder} declares or plans.`
}

function note_of(
	watch: Watch,
	issues: ReadonlyArray<OpenIssueData> | undefined,
): string | undefined {
	if (issues === undefined) return auto_ok_cli.UNREADABLE_MESSAGE

	const clash = clash_among(watch, issues)

	return clash === undefined ? undefined : clash_note(watch.plan.issue, clash)
}

// A note is printed when it changes, so a wait of minutes says why once rather than every poll.
function settle(watch: Watch, note: string | undefined): boolean {
	if (note !== undefined && note !== watch.note) console.error(note)
	watch.note = note

	return note === undefined
}

async function is_clear(watch: Watch): Promise<boolean> {
	const issues = await running_issues()

	return settle(watch, note_of(watch, issues))
}

async function watch_plan(watch: Watch, options: PollOptions): Promise<number> {
	lane_plan.record(watch.plan, watch.directory)
	const is_done = await poll.poll_until(async () => await is_clear(watch), options)

	console.info(is_done ? 'clear' : 'wait')

	return is_done ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(
	argv: ReadonlyArray<string>,
	options: PollOptions = WAIT_POLL,
	directory: string = process.cwd(),
): Promise<number> {
	const plan = plan_of(argv, new Date())

	if (plan !== undefined) return await watch_plan({ plan, directory }, options)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_plan_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_plan_cli }
