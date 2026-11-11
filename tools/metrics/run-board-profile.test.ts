import { describe, expect, it, vi } from 'vitest'
import { run_board_profile, type Piece, type ProfilePorts, type Sample } from './run-board-profile'

const { format, measure, measure_all } = run_board_profile
const RUNS = 4
const WALL_STEP_MS = 3
const CPU_STEP_MS = 2
const HEAP_STEP_BYTES = 2048
const PER_MINUTE = 60

interface Meter {
	wall: number
	cpu: number
	heap: number
}

// Each run advances the fake clocks by one step, so the per-call figures are the steps.
function fixture_of(): { ports: ProfilePorts; piece: Piece; settle: ReturnType<typeof vi.fn> } {
	const meter: Meter = { wall: 0, cpu: 0, heap: 0 }
	const settle = vi.fn()
	const ports = {
		now: () => meter.wall,
		cpu_ms: () => meter.cpu,
		heap_bytes: () => meter.heap,
		settle,
	}
	const run = vi.fn(async () => {
		meter.wall += WALL_STEP_MS
		meter.cpu += CPU_STEP_MS
		meter.heap += HEAP_STEP_BYTES
	})

	return { ports, piece: { label: 'sysctl', per_minute: PER_MINUTE, run }, settle }
}

function sample_of(label: string, cpu_ms: number): Sample {
	return { label, per_minute: PER_MINUTE, wall_ms: 1, cpu_ms, heap_bytes: 1024 }
}

describe('run_board_profile.measure', () => {
	it('runs the piece the given times and averages each figure per call', async () => {
		const { ports, piece } = fixture_of()

		const sample = await measure(piece, RUNS, ports)

		expect(piece.run).toHaveBeenCalledTimes(RUNS)
		expect(sample).toEqual({
			label: 'sysctl',
			per_minute: PER_MINUTE,
			wall_ms: WALL_STEP_MS,
			cpu_ms: CPU_STEP_MS,
			heap_bytes: HEAP_STEP_BYTES,
		})
	})

	it('settles the heap before each piece', async () => {
		const { ports, piece, settle } = fixture_of()

		await measure_all([piece, { ...piece, label: 'ps' }], 1, ports)

		expect(settle).toHaveBeenCalledTimes(2)
	})

	it('measures without settling where no collection is allowed', async () => {
		const { ports, piece } = fixture_of()

		const sample = await measure(piece, 1, { ...ports, settle: undefined })

		expect(sample.cpu_ms).toBe(CPU_STEP_MS)
	})
})

describe('run_board_profile.runs_of', () => {
	it('takes a positive whole number as the runs', () => {
		expect(run_board_profile.runs_of('5')).toBe(5)
	})

	it.each([undefined, 'abc', '0', '-3', '2.5'])('falls back to the default for %s', (argument) => {
		expect(run_board_profile.runs_of(argument)).toBe(run_board_profile.DEFAULT_RUNS)
	})
})

describe('run_board_profile.LIVE_PORTS', () => {
	const { LIVE_PORTS } = run_board_profile

	it('reads a clock and this process CPU time that never go back', () => {
		const before = { now: LIVE_PORTS.now(), cpu: LIVE_PORTS.cpu_ms() }

		expect(LIVE_PORTS.now()).toBeGreaterThanOrEqual(before.now)
		expect(LIVE_PORTS.cpu_ms()).toBeGreaterThanOrEqual(before.cpu)
		expect(before.cpu).toBeGreaterThan(0)
	})

	it('reads the heap in use and settles without --expose-gc', () => {
		expect(LIVE_PORTS.heap_bytes()).toBeGreaterThan(0)
		expect(() => LIVE_PORTS.settle?.()).not.toThrow()
	})
})

describe('run_board_profile.format', () => {
	it('puts the read with the most CPU per minute first, weighted by its calls', () => {
		const table = format([sample_of('git', 1), sample_of('stream', 3)])

		expect(table.split('\n')).toEqual([
			'| read | calls/min | wall ms | cpu ms | cpu ms/min | heap KiB | heap MiB/min |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			'| stream | 60 | 1.00 | 3.00 | 180.00 | 1.00 | 0.06 |',
			'| git | 60 | 1.00 | 1.00 | 60.00 | 1.00 | 0.06 |',
		])
	})
})
