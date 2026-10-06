import { describe, expect, it } from 'vitest'
import { lane_load } from './lane-load'
import type { LaneInfo } from './lane-registry'

// joshuafolkken/kit#3355: swap is read per platform, and an output nobody recognizes leaves the
// sample without swap rather than recording a zero nobody measured.

const MEMORY_LINE = 'MemTotal: 16000000 kB'
const LINUX_MEMINFO = [MEMORY_LINE, 'SwapTotal: 4194304 kB', 'SwapFree: 3145728 kB'].join('\n')

describe('lane_load.parse_darwin_swap', () => {
	it('reads a used figure given in megabytes', () => {
		const output = 'total = 5120.00M  used = 3993.25M  free = 1126.75M  (encrypted)'

		expect(lane_load.parse_darwin_swap(output)).toBe(3993.25)
	})

	it('scales a used figure given in gigabytes', () => {
		const output = 'total = 8.00G  used = 2.50G  free = 5.50G  (encrypted)'

		expect(lane_load.parse_darwin_swap(output)).toBe(2560)
	})

	it('answers undefined for an unrecognized output', () => {
		expect(lane_load.parse_darwin_swap('no swap here')).toBeUndefined()
	})
})

describe('lane_load.parse_linux_swap', () => {
	it('derives the swap in use from the total and the free swap', () => {
		expect(lane_load.parse_linux_swap(LINUX_MEMINFO)).toBe(1024)
	})

	it('answers undefined when a swap line is missing', () => {
		expect(lane_load.parse_linux_swap(MEMORY_LINE)).toBeUndefined()
	})
})

function lane(issue: string, is_stranded: boolean): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded,
	}
}

describe('lane_load.count_working', () => {
	it('counts only open lanes whose child process is running', () => {
		const lanes = [lane('1', false), lane('2', false), lane('3', true)]
		const running = new Set(['1', '3'])

		expect(lane_load.count_working(lanes, (issue) => running.has(issue))).toBe(1)
	})

	it('counts no lane when only a parked lane is open', () => {
		expect(lane_load.count_working([lane('4', false)], () => false)).toBe(0)
	})
})

describe('lane_load.read_swap_mb', () => {
	it('answers undefined on a platform with no swap reading', async () => {
		await expect(lane_load.read_swap_mb('win32')).resolves.toBeUndefined()
	})
})
