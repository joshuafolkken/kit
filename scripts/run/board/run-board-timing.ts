import { launch_timing } from '#scripts/lane/launch-timing'
import type { BoardPorts } from './run-board-state'

// `josh run:board --timing` (joshuafolkken/kit#7929): what the first board waited on, said once the
// board is done — after the frame `--once` draws, or after a live board leaves its screen. Each phase
// is `launch_timing`'s: the launcher's rebuild and core wait, the reads `read_local` and `resample`
// timed (on the worker for a live board, handed over with its first round), the worker's first answer,
// and when the first read came back and the first frame was written, counted from the process start.

const TIMING_FLAG = '--timing'
const FIRST_READ_PHASE = 'first read at'
const FIRST_FRAME_PHASE = 'first frame at'
const HEADING = 'run:board timing (ms):'

interface TimingArgv {
	argv: Array<string>
	is_timing: boolean
}

function split(argv: ReadonlyArray<string>): TimingArgv {
	const rest = argv.filter((argument) => argument !== TIMING_FLAG)

	return { argv: rest, is_timing: rest.length < argv.length }
}

function launched(): Array<[string, number | undefined]> {
	return [
		['rebuild', launch_timing.rebuild_ms()],
		['core wait', launch_timing.core_wait_ms()],
	]
}

function report(): string {
	const named = launched().filter((entry): entry is [string, number] => entry[1] !== undefined)
	const rows = [...named, ...launch_timing.phases().map(({ name, ms }) => [name, ms] as const)]
	const width = Math.max(0, ...rows.map(([name]) => name.length))
	const lines = rows.map(([name, ms]) => `  ${name.padEnd(width)}  ${String(Math.round(ms))}`)

	return `${[HEADING, ...lines].join('\n')}\n`
}

function reporting(ports: BoardPorts, leave: () => void): () => void {
	return () => {
		leave()
		ports.write(report())
	}
}

// The ports with the first read and the first frame marked, and the report said after the screen is
// left. Without `--timing` they are the ports as they came.
function timed(
	ports: BoardPorts,
	is_timing: boolean,
	now: () => number = performance.now.bind(performance),
): BoardPorts {
	if (!is_timing) return ports
	let has_read = false

	return {
		...ports,
		gather: async (pace) => {
			const read = await ports.gather(pace)

			launch_timing.mark(FIRST_READ_PHASE, now())
			has_read = true

			return read
		},
		write: (frame) => {
			ports.write(frame)
			if (has_read) launch_timing.mark(FIRST_FRAME_PHASE, now())
		},
		on_exit: (leave) => {
			ports.on_exit(reporting(ports, leave))
		},
	}
}

// The report a single frame says after it, where `--timing` asked for one.
function say(ports: BoardPorts, is_timing: boolean): void {
	if (is_timing) ports.write(report())
}

const run_board_timing = {
	FIRST_FRAME_PHASE,
	FIRST_READ_PHASE,
	TIMING_FLAG,
	report,
	say,
	split,
	timed,
}

export { run_board_timing }
