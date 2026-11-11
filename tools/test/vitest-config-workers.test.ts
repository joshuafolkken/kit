import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { unit_lane_count } from '#scripts/test/unit-lane-count'
import { unit_run_marker } from '#scripts/test/unit-run-marker'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vitest_config_workers } from './vitest-config-workers'

// joshuafolkken/kit#4262: a direct `pnpm vitest run` in a lane opened nine workers beside a gate,
// because the share reached vitest only through the `--maxWorkers` `josh` appended.

// The machine the incident was measured on: 11 logical cores.
const MEASURED_CORES = 11
const PROBE_PREFIX = 'josh-config-workers-test-'

const { lane_count_probe } = vitest_config_workers
const outer_flag = process.env[unit_worker_share.NESTED_KEY]
const probe = { directory: '' }

// A live unit run's marker — this process's own identity, so it counts as running.
function record_other_run(): void {
	const marker = path.join(probe.directory, `${unit_worker_share.RUN_PREFIX}other.json`)

	writeFileSync(marker, JSON.stringify(process_identity.own_fields()))
}

// One live lane — this one — so the machine's own lanes do not move the answers below.
function workers(lanes = 1): number | undefined {
	return vitest_config_workers.config_workers(MEASURED_CORES, probe.directory, lanes)
}

const make_directory = temporary_directory()

beforeEach(() => {
	probe.directory = make_directory(PROBE_PREFIX)
	process.env[unit_worker_share.NESTED_KEY] = ''
})

afterEach(() => {
	process.env[unit_worker_share.NESTED_KEY] = outer_flag ?? ''
	vi.restoreAllMocks()
})

describe('vitest_config_workers.config_workers — direct run marker', () => {
	// A gate started after a direct run has to see it, or it takes the whole machine beside it.
	it('records the direct run so a later run divides the machine with it', () => {
		workers()

		expect(unit_worker_share.live_run_count(probe.directory)).toBe(1)
	})

	// A watch-mode reload loads the config again in the same process.
	it('does not count its own marker as a second run on reload', () => {
		workers()

		expect(workers()).toBeUndefined()
	})
})

describe('vitest_config_workers.config_workers', () => {
	it('takes the share a direct run would get beside another recorded unit run', () => {
		record_other_run()

		expect(workers()).toBe(unit_worker_share.current_share(MEASURED_CORES, 1))
		expect(workers()).toBe(5)
	})

	it("leaves vitest's default when no other run is recorded", () => {
		expect(workers()).toBeUndefined()
	})

	// joshuafolkken/kit#6682: a direct run beside idle lanes takes only its lane's share.
	it('takes its lane share when other lanes are live', () => {
		const lanes = 3

		expect(workers(lanes)).toBe(3)
	})

	it('reads the live lanes when no count is passed', () => {
		const lanes = 3

		vi.spyOn(lane_count_probe, 'spawned_lane_count').mockReturnValue(lanes)

		expect(vitest_config_workers.config_workers(MEASURED_CORES, probe.directory)).toBe(
			workers(lanes),
		)
	})

	// The `josh` guard sizes a nested run itself; a second answer here would make two deciders.
	it('leaves a josh-driven run to the flag josh passed', () => {
		record_other_run()
		process.env[unit_worker_share.NESTED_KEY] = unit_worker_share.NESTED_VALUE

		expect(workers()).toBeUndefined()
	})

	it("falls back to vitest's default when the share cannot be read", () => {
		vi.spyOn(unit_run_marker, 'live_run_count').mockImplementation(() => {
			throw new Error('unreadable')
		})

		expect(workers()).toBeUndefined()
	})
})

// joshuafolkken/kit#7254: the config counts the lanes in a child process, so the lane reading stays out
// of its imports — and the child has to answer what the in-process reading answers.
describe('vitest_config_workers.lane_count_probe.spawned_lane_count', () => {
	const LANES = ['6682', '6905']

	// A repository checkout beside a lanes root holding two lanes, read with no environment.
	function checkout_beside_lanes(): string {
		const parent = probe.directory

		for (const name of LANES) mkdirSync(path.join(parent, '.repo-lanes', name), { recursive: true })

		return path.join(parent, 'repo')
	}

	it('counts the lanes the in-process reading counts', () => {
		const checkout = checkout_beside_lanes()

		expect(lane_count_probe.spawned_lane_count(checkout, {})).toBe(LANES.length)
		expect(lane_count_probe.spawned_lane_count(checkout, {})).toBe(
			unit_lane_count.live_lane_count(checkout, {}),
		)
	})

	it('counts no lane when the child prints no number', () => {
		const broken = { NODE_OPTIONS: '--no-such-node-flag' }

		expect(lane_count_probe.spawned_lane_count(checkout_beside_lanes(), broken)).toBe(0)
	})

	it('spawns no lane count for a josh-driven run', () => {
		const spawned = vi.spyOn(lane_count_probe, 'spawned_lane_count')

		process.env[unit_worker_share.NESTED_KEY] = unit_worker_share.NESTED_VALUE
		vitest_config_workers.config_workers(MEASURED_CORES, probe.directory)

		expect(spawned).not.toHaveBeenCalled()
	})
})
