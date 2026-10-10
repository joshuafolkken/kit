import type { machine_capacity } from '#scripts/gate/machine-capacity'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_load } from './lane-load'
import { lane_registry, type LaneInfo } from './lane-registry'

// joshuafolkken/kit#3355: a load sample sets the machine's load beside the lanes with a child working.
// joshuafolkken/kit#3593: its memory is the reading the gate admits against — `os.freemem()` read near
// zero on macOS, and a second swap parser measured a different figure for the same machine.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

const AT = '2026-10-10T00:00:00.000Z'
// Half the memory available, and 256 + 512 pages of 4 KB: 3 MB swapped since boot.
const SYSCTL_OUTPUT = [
	'kern.memorystatus_level: 50',
	'vm.compressor.swapper.swapins_total: 256',
	'vm.compressor.swapper.swapouts_total: 512',
	'hw.pagesize: 4096',
].join('\n')
const SWAPPED_MB = 3

function stub_platform(platform: NodeJS.Platform): void {
	vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
}

// The reading the gate's admission takes — the real `read_machine`, which the machine guard replaces in
// every worker — with its sampling window skipped.
async function read_admission(): Promise<number | undefined> {
	const actual = await vi.importActual<{ machine_capacity: typeof machine_capacity }>(
		'#scripts/gate/machine-capacity',
	)
	const reading = await actual.machine_capacity.read_machine(async () => {
		await Promise.resolve()
	})

	return reading.available_mb
}

beforeEach(() => {
	hanging_execa.reset()
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([])
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_load.sample', () => {
	it('shares the memory reading the gate admits against', async () => {
		stub_platform('darwin')
		hanging_execa.answer_with('sysctl', SYSCTL_OUTPUT)

		const sample = await lane_load.sample(AT)
		const available_mb = await read_admission()
		const [sampled, admitted] = hanging_execa.calls()

		expect(available_mb).toBeGreaterThan(0)
		expect(sample.available_mb).toBe(Math.round(available_mb ?? 0))
		expect(sample.swapped_mb).toBe(SWAPPED_MB)
		expect(hanging_execa.calls()).toHaveLength(2)
		expect(sampled).toStrictEqual(admitted)
	})

	it('records the sample without memory on a platform the reading does not cover', async () => {
		stub_platform('win32')

		await expect(lane_load.sample(AT)).resolves.toMatchObject({
			kind: 'load',
			at: AT,
			available_mb: undefined,
			swapped_mb: undefined,
			lanes: 0,
		})
		expect(hanging_execa.calls()).toHaveLength(0)
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
