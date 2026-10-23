import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { unit_run_marker } from '#scripts/test/unit-run-marker'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vitest_config_workers } from './vitest-config-workers'

// joshuafolkken/kit#4262: a direct `pnpm vitest run` in a lane opened nine workers beside a gate,
// because the share reached vitest only through the `--maxWorkers` `josh` appended.

// The machine the incident was measured on: 11 logical cores.
const MEASURED_CORES = 11
const PROBE_PREFIX = 'josh-config-workers-test-'

const outer_flag = process.env[unit_worker_share.NESTED_KEY]
const probe = { directory: '' }

// A live unit run's marker — this process's own identity, so it counts as running.
function record_other_run(): void {
	const marker = path.join(probe.directory, `${unit_worker_share.RUN_PREFIX}other.json`)

	writeFileSync(marker, JSON.stringify(process_identity.own_fields()))
}

function workers(): number | undefined {
	return vitest_config_workers.config_workers(MEASURED_CORES, probe.directory)
}

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), PROBE_PREFIX))
	process.env[unit_worker_share.NESTED_KEY] = ''
})

afterEach(() => {
	process.env[unit_worker_share.NESTED_KEY] = outer_flag ?? ''
	rmSync(probe.directory, { recursive: true, force: true })
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
