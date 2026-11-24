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

// Every spot recolored where the field's light changed since `since`; all of them with no `since`.
function traces_bytes(
	spots: ReadonlyArray<Spot>,
	at_ms: number,
	since: number | undefined,
): string {
	const { is_lit } = run_board_header_trace

	if (since !== undefined && is_lit(at_ms) === is_lit(since)) return ''

	return spots.map((spot) => trace_bytes(spot, at_ms)).join('')
}

function write_traces(
	spots: ReadonlyArray<Spot>,
	ports: Pick<BoardPorts, 'write' | 'write_drawn'>,
	at_ms: number,
	since: number | undefined,
): void {
	const bytes = traces_bytes(spots, at_ms, since)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

const run_board_trace_spot = { traces_bytes, traces_in, write_traces }

export { run_board_trace_spot }
