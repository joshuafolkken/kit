import { run_board_header_trace } from './run-board-header-trace'
import { run_board_screen } from './run-board-screen'
import { run_board_spot, type Spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'

// The worst TRACE field alone is recolored between full frames (joshuafolkken/kit#8391).
const { TRACE, spot_at } = run_board_spot
const CSI = '\u{1B}['

function traces_in(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	columns: number,
): Array<Spot> {
	return lines.flatMap((line, index) =>
		[...line.matchAll(new RegExp(TRACE, 'gu'))].map((match) =>
			spot_at(line, match.index, starts[index] ?? 1, columns),
		),
	)
}

function trace_bytes(spot: Spot, at_ms: number): string {
	return `${CSI}${String(spot.row)};${String(spot.column)}H${run_board_header_trace.alert_at(at_ms)}`
}

function write_traces(
	spots: ReadonlyArray<Spot>,
	ports: Pick<BoardPorts, 'write' | 'write_drawn'>,
	at_ms: number,
	since: number | undefined,
): void {
	if (
		since !== undefined &&
		run_board_header_trace.is_lit(at_ms) === run_board_header_trace.is_lit(since)
	) {
		return
	}

	const bytes = spots.map((spot) => trace_bytes(spot, at_ms)).join('')

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

const run_board_trace_spot = { traces_in, write_traces }

export { run_board_trace_spot }
