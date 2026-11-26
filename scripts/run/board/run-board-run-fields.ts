import type { LaneInfo } from '#scripts/lane/lane-registry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_wake } from '#scripts/run/wake/run-wake'
import { run_board_operation_read, type OperationSources } from './run-board-operation-read'
import type { LocalRead } from './run-board-read'
import { run_board_scope } from './run-board-scope'
import { run_board_single } from './run-board-single'
import type { BoardSpan } from './run-board-span'
import type { SpanHere } from './run-board-span-read'
import { run_board_throughput } from './run-board-throughput'

type RunSpan = SpanHere & { span: BoardSpan }
type RunFields = Pick<
	LocalRead,
	| keyof Omit<SpanHere, 'span' | 'singles' | 'transcript'>
	| 'scope'
	| 'throughput'
	| 'lanes'
	| 'operations'
>

// Where each session of the run writes what it does: a lane's child to its dispatch log, in the lane's
// own checkout; each single run beside them, else the drawn single run, to its transcript, read as one
// more child's (`run_board_single.sources_of`), never listed as a lane; the parent and a judgment
// session to theirs, in this one.
function sources_of(
	repository: string,
	lanes: ReadonlyArray<LaneInfo>,
	read: Pick<RunSpan, 'span' | 'singles' | 'transcript'>,
): OperationSources {
	const root = process.cwd()
	const children = lanes.map((lane) => ({
		issue: lane.issue,
		log: lane.output,
		root: lane.directory,
	}))

	return {
		lanes: [
			...children,
			...[read.span, ...(read.singles ?? [])].flatMap((span) => run_board_single.sources_of(span)),
		],
		owner: { log: read.transcript, root },
		judgment: { log: run_wake.wake_log_path(repository), root },
	}
}

// The fields read off the span's record and the run's stream, with no subprocess.
function fields_of(
	repository: string,
	read: RunSpan,
	lanes: ReadonlyArray<LaneInfo>,
	events: ReadonlyArray<RunEvent>,
): RunFields {
	const { span, carry, resume, roots, is_stranded, is_session_active } = read

	return {
		scope: run_board_scope.scope_of(span.invocation, carry?.added),
		throughput: run_board_throughput.rows_of(events, Date.now()),
		lanes: lanes.map((lane) => lane.issue),
		resume,
		roots,
		carry,
		is_stranded,
		is_session_active,
		operations: run_board_operation_read.read(sources_of(repository, lanes, read)),
	}
}

const run_board_run_fields = { fields_of, sources_of }

export { run_board_run_fields }
export type { RunSpan }
