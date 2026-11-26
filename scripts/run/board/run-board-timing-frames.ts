// One live `run:board` frame's cost under `--timing` (joshuafolkken/kit#8917): the time its layers took
// to compose onto the canvas and the bytes written for it, each frame the frame loop draws, said as the
// most and the average of the frames drawn while the board was up. The frame loop hands each frame in
// through `framed`; only a board under `--timing` collects them. Each measure is kept as a running count,
// sum and most, never as the frames themselves, so a board timed for days holds no more than one timed
// for a second.

type Row = [string, string]

// One measure's running sum and most over the frames drawn so far.
interface Aggregate {
	sum: number
	most: number
}

// The frames drawn so far: how many, their compose time in ms and the bytes written for them.
interface FrameStats {
	count: number
	compose_ms: Aggregate
	bytes: Aggregate
}

const COMPOSE_ROW = 'frame compose'
const BYTES_ROW = 'frame bytes'

// The frames being collected, from when a board under `--timing` takes its screen until its report.
const collecting: { stats?: FrameStats | undefined } = {}

// Neither a compose time nor a frame's bytes is below 0, so 0 is the most of none.
function empty(): Aggregate {
	return { sum: 0, most: 0 }
}

// No frame drawn yet.
function fresh(): FrameStats {
	return { count: 0, compose_ms: empty(), bytes: empty() }
}

function add(aggregate: Aggregate, value: number): void {
	aggregate.sum += value
	aggregate.most = Math.max(aggregate.most, value)
}

// One frame's compose time and the bytes written for it, collected where a board is timed.
function framed(compose_ms: number, bytes: number): void {
	const { stats } = collecting

	if (stats === undefined) return
	stats.count += 1
	add(stats.compose_ms, compose_ms)
	add(stats.bytes, bytes)
}

// Every frame from here on collected into the stats returned.
function watch(): FrameStats {
	const stats = fresh()

	collecting.stats = stats

	return stats
}

function stop(): void {
	collecting.stats = undefined
}

// The compose time in ms to a tenth and the bytes written, each its max and average; none where no frame
// was drawn.
function rows(stats: FrameStats): Array<Row> {
	const { count, compose_ms, bytes } = stats
	const counted = `(n ${String(count)})`

	if (count === 0) return []

	return [
		[
			COMPOSE_ROW,
			`max ${compose_ms.most.toFixed(1)} · average ${(compose_ms.sum / count).toFixed(1)} ${counted}`,
		],
		[
			BYTES_ROW,
			`max ${String(bytes.most)} B · average ${String(Math.round(bytes.sum / count))} B ${counted}`,
		],
	]
}

const run_board_timing_frames = { BYTES_ROW, COMPOSE_ROW, framed, fresh, rows, stop, watch }

export { run_board_timing_frames }
export type { FrameStats }
