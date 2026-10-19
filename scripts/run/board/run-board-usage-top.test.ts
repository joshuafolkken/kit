import { describe, expect, it, vi } from 'vitest'
import { run_board_usage_top, type TopPorts } from './run-board-usage-top'

const { TOP_INTERVAL_MS, parse_top, top_reader } = run_board_usage_top
const KB = 1024
const MB = KB * KB
const GB = MB * KB
const FAILED = new Error('top failed')
const LISTING = [
	'Processes: 547 total, 4 running',
	'PhysMem: 16G used (7105M wired, 2575M compressor), 1259M unused.',
	'',
	'PID    MEM   CMPRS',
	'99923  184M  120M ',
	'97672  2080K+ 1856K-',
	'96874  1.5G  0B',
].join('\n')

describe('parse_top', () => {
	it('reads each process line in 1024-based units and skips the rest', () => {
		const readings = parse_top(LISTING)

		expect([...readings.keys()]).toEqual([99_923, 97_672, 96_874])
		expect(readings.get(99_923)).toEqual({ memory_bytes: 184 * MB, compressed_bytes: 120 * MB })
		expect(readings.get(97_672)).toEqual({ memory_bytes: 2080 * KB, compressed_bytes: 1856 * KB })
		expect(readings.get(96_874)).toEqual({ memory_bytes: 1.5 * GB, compressed_bytes: 0 })
	})
})

function ports_at(clock: { ms: number }, outputs: Array<string | Error>): TopPorts {
	async function list(): Promise<string> {
		const output = outputs.shift() ?? ''

		if (output instanceof Error) throw output

		return output
	}

	return { list: vi.fn(list), now: () => clock.ms }
}

async function pids_of(
	read: () => ReturnType<ReturnType<typeof top_reader>>,
): Promise<Array<number>> {
	const readings = await read()

	return [...readings.keys()]
}

describe('top_reader', () => {
	it('waits for the first reading and draws the held one until it is stale', async () => {
		const clock = { ms: 0 }
		const ports = ports_at(clock, ['1 1K 0B', '2 2K 0B'])
		const read = top_reader(ports)

		await expect(pids_of(read)).resolves.toEqual([1])
		clock.ms = TOP_INTERVAL_MS - 1
		await expect(pids_of(read)).resolves.toEqual([1])
		expect(ports.list).toHaveBeenCalledTimes(1)
		clock.ms = TOP_INTERVAL_MS
		await expect(pids_of(read)).resolves.toEqual([1])
		await vi.waitFor(async () => {
			await expect(pids_of(read)).resolves.toEqual([2])
		})
	})

	it('keeps the earlier reading when a later top fails', async () => {
		const clock = { ms: 0 }
		const read = top_reader(ports_at(clock, ['1 1K 0B', FAILED]))

		await read()
		clock.ms = TOP_INTERVAL_MS
		await read()
		await Promise.resolve()

		await expect(pids_of(read)).resolves.toEqual([1])
	})

	it('reads an empty map when the first top fails', async () => {
		const read = top_reader(ports_at({ ms: 0 }, [FAILED]))

		await expect(pids_of(read)).resolves.toEqual([])
	})
})
