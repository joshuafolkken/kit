import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_paths } from '#scripts/lane/lane-paths'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import { run_board_span, type BoardSpan } from './run-board-span'

// A single `fullrun #N` or `halfrun #N` has no carry record; the only record that says it is running
// here is this checkout's hold (`run-hold.ts`), so the board draws it from there — no store of its own
// (joshuafolkken/kit#6597). The hold marks a `fullrun` (`is_fullrun`); `run:entry` claims a `halfrun`
// unmarked (`run-entry-children.ts`), so an unmarked numbered hold is one.

const FULLRUN = 'fullrun'
const HALFRUN = 'halfrun'
const SINGLE_INVOCATION = /^(?<command>fullrun|halfrun) #(?<issue>\d+)$/u
// The launch the board reads a row's running state from, placed before every event of the run.
const LAUNCH_POSITION = 0

interface SingleRun {
	command: string
	issue: number
}

interface RootRun extends SingleRun {
	events: ReadonlyArray<RunEvent>
}

// The checkout's own git directory, resolved once per working directory: resolving it runs a `git`
// subprocess the redraw would wait on, as `run-board-read.ts`'s main work tree does.
const directories = stamped_memo.create<Promise<string | undefined>>()

// A held, numbered hold is a running run unless a stop marked it: a stopped `halfrun` or `prrun` keeps
// its hold across a person's latency (`run_hold.is_stop_marked`), long after the run stopped.
function is_running(read: HoldRead): read is Extract<HoldRead, { kind: 'held' }> {
	if (read.kind !== 'held') return false

	return issue_number_shape.is_issue_number(read.hold.issue) && !run_hold.is_stop_marked(read.hold)
}

function span_of(read: HoldRead): BoardSpan | undefined {
	if (!is_running(read)) return undefined

	const started_ms = run_event_scope.moment_of(read.hold.taken_at)

	if (started_ms === undefined) return undefined

	const command = read.hold.is_fullrun === true ? FULLRUN : HALFRUN

	return {
		invocation: `${command} ${issue_cite.plain_for('program', read.hold.issue)}`,
		started_ms,
		ended_ms: undefined,
	}
}

// A failed resolve is forgotten, so a `git` that timed out once is asked again on the next redraw, as
// `run-board-read.ts`'s main work tree is.
async function directory_here(): Promise<string | undefined> {
	try {
		return await directories.of(
			process.cwd(),
			stamped_memo.NO_STAMP,
			async () => await run_hold.worktree_directory(),
		)
	} catch (error) {
		directories.keep(new Set())
		throw error
	}
}

// The single run held in this checkout; `undefined` where none is. A lane's hold is its `backlogrun`
// child's, drawn as that run's row, so only outside a lane is a hold read beside the carry record — a
// `fullrun` in the root checkout beside a running `backlogrun`.
async function span_here(is_carried: boolean): Promise<BoardSpan | undefined> {
	if (is_carried && lane_paths.lane_issue_of(process.cwd()) !== undefined) return undefined

	const directory = await directory_here()

	if (directory === undefined) return undefined

	return span_of(run_hold.read_hold(run_hold.hold_path(directory)))
}

// The command and issue of a single run's invocation; `undefined` for any other run's.
function single_of(invocation: string): SingleRun | undefined {
	const { command, issue } = SINGLE_INVOCATION.exec(invocation)?.groups ?? {}

	if (command === undefined || issue === undefined) return undefined

	return { command, issue: Number(issue) }
}

// A single run covers its own issue alone; `undefined` for any other run's invocation.
function scope_of(invocation: string): NamedPlan | undefined {
	const single = single_of(invocation)

	return single === undefined ? undefined : { issues: [single.issue], only: true }
}

// A single run's issue is running from the hold on: the launch event its row's phase is read after
// (`run-board-status.ts`), which no lane dispatch wrote for it. Every other run's events stay as read.
function events_of(span: BoardSpan, events: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> {
	const single = single_of(span.invocation)

	if (single === undefined) return events

	const launch: RunEvent = {
		pos: LAUNCH_POSITION,
		at: new Date(span.started_ms).toISOString(),
		kind: run_event_stream.EVENT_KIND.CHILD_LAUNCH,
		text: `${issue_cite.plain_for('program', single.issue)} ${single.command}`,
	}

	return [launch, ...events]
}

// The run's name the board's header draws; `undefined` for a `backlogrun`, the header's own.
function name_of(invocation: string): string | undefined {
	return single_of(invocation)?.command
}

// The root checkout's single run beside a carried run, with its own span's events its row's phase is
// read from (joshuafolkken/kit#7524).
function root_of(span: BoardSpan, events: ReadonlyArray<RunEvent>): RootRun | undefined {
	const single = single_of(span.invocation)

	if (single === undefined) return undefined

	return { ...single, events: events_of(span, run_board_span.events_of(events, span)) }
}

const run_board_single = { events_of, name_of, root_of, scope_of, span_here, span_of }

export { run_board_single }
export type { RootRun }
