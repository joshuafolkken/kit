import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import type { ProcessRoots } from './run-board-process-groups'
import { run_board_roots } from './run-board-roots'
import { run_board_single } from './run-board-single'
import { run_board_span, type BoardSpan } from './run-board-span'

// What `run:board` reads of the run drawn here: its span, the session it resumes from and the
// processes its record names.
interface SpanHere {
	span: BoardSpan | undefined
	resume: string | undefined
	// The parent session's transcript, where the run's record names one.
	transcript: string | undefined
	roots: ProcessRoots
	carry: RunCarry | undefined
	is_stranded: boolean
	is_session_active: boolean
	// The root checkout's single run beside the carried one.
	root?: BoardSpan | undefined
}

const NO_SPAN: SpanHere = {
	span: undefined,
	resume: undefined,
	transcript: undefined,
	roots: {},
	carry: undefined,
	is_stranded: false,
	is_session_active: false,
}

// Every process the run's record names is asked of `table`, the redraw's own `ps` snapshot — only once
// a run is found, so a repository with no run waits on no `ps`.
async function recorded_span_here(
	repository: string,
	table: TableRead | undefined,
	read: CarryRead,
): Promise<SpanHere> {
	const ended = run_carry_ended.read_ended(run_carry_ended.ended_path(repository))
	const launch = backlogrun_launch.pending_launch(repository)
	const span = run_board_span.span_of(read, ended, launch)

	if (span === undefined) return NO_SPAN

	const same_process = await run_board_roots.same_in(table)
	const stranded_ports = run_stranded_detect.ports_with(same_process)

	return {
		span,
		resume: run_board_span.resume_of(read, ended, launch),
		transcript: read.kind === 'carried' ? read.carry.owner_transcript : undefined,
		roots: run_board_roots.roots_of(repository, read, same_process),
		is_session_active: run_board_roots.session_is_active(repository, read, same_process),
		carry: read.kind === 'carried' ? read.carry : undefined,
		is_stranded: run_stranded_detect.is_stranded_at(repository, stranded_ports),
	}
}

// A single run this checkout holds is the one drawn (`run-board-single.ts`) before the ended run; it
// names no process. Beside a carried run it is the root checkout's, drawn as a row above the carried
// run's lanes, which stays the frame (joshuafolkken/kit#7524). No repository, no run.
async function span_here(
	repository: string | undefined,
	table: TableRead | undefined,
): Promise<SpanHere> {
	if (repository === undefined) return NO_SPAN
	const read = run_carry.read_carry(run_carry.carry_path(repository))
	const is_carried = read.kind !== 'none'
	const single = await run_board_single.span_here(is_carried)

	if (single === undefined) return await recorded_span_here(repository, table, read)
	if (!is_carried) return { ...NO_SPAN, span: single }

	return { ...(await recorded_span_here(repository, table, read)), root: single }
}

const run_board_span_read = { span_here }

export { run_board_span_read }
export type { SpanHere }
