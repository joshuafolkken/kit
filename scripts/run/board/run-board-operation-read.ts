import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { run_board_operation, type Operation } from './run-board-operation'

// The disk half of the third line's operation: the end of each session's log, read every time the
// board re-reads its run. **A fixed, small read**: a dispatch log grows to tens of megabytes and the
// watcher's log across runs, while the board re-reads every five seconds. The newest call is nearly
// always inside it; where one line is longer than the read, there is no operation and the line says
// what it said before. Nothing here may fail — a log that is missing or unreadable is no operation.

const TAIL_BYTES = 65_536

// A session's log and the checkout its paths are drawn from.
interface OperationSource {
	log: string | undefined
	root: string | undefined
}

interface LaneSource extends OperationSource {
	issue: string
}

interface OperationSources {
	lanes: ReadonlyArray<LaneSource>
	// The parent session's transcript.
	owner: OperationSource
	// The watcher's log, which a judgment session appends to.
	judgment: OperationSource
}

interface LaneOperation {
	issue: number
	operation: Operation
}

// The newest operation of every session the run may have at work; which of them is at work now is the
// reader's to say.
interface SessionOperations {
	lanes: ReadonlyArray<LaneOperation>
	owner: Operation | undefined
	judgment: Operation | undefined
}

type ReadTail = (file_path: string, max_bytes: number) => string

function operation_of(source: OperationSource, read_tail: ReadTail): Operation | undefined {
	if (source.log === undefined) return undefined

	try {
		return run_board_operation.latest_of(read_tail(source.log, TAIL_BYTES), source.root)
	} catch {
		return undefined
	}
}

function lane_operation(source: LaneSource, read_tail: ReadTail): Array<LaneOperation> {
	const operation = operation_of(source, read_tail)

	return operation === undefined ? [] : [{ issue: Number(source.issue), operation }]
}

function read(
	sources: OperationSources,
	read_tail: ReadTail = time_density_hook.read_tail,
): SessionOperations {
	return {
		lanes: sources.lanes.flatMap((lane) => lane_operation(lane, read_tail)),
		owner: operation_of(sources.owner, read_tail),
		judgment: operation_of(sources.judgment, read_tail),
	}
}

const run_board_operation_read = { TAIL_BYTES, read }

export { run_board_operation_read }
export type { LaneOperation, OperationSources, SessionOperations }
