import { lane_ledger } from '#scripts/lane/lane-ledger'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unit_file_reporter, type TimedModule } from './unit-file-reporter'

// joshuafolkken/kit#4451: a unit run whose wall time far outran its CPU left no record of the file it
// stalled on, so each run's slowest files reach the lane ledger.

const ROOT = '/repository'
const SETUP_MS = 10
const SETUP_PHASES = 4
const SLOW_MS = 370_000
const STALLED = 'stalled.test.ts'
const REPOSITORY = '/repository/.git'

function timed(file: string, duration: number, root: string = ROOT): TimedModule {
	return {
		moduleId: `${root}/${file}`,
		diagnostic: () => ({
			environmentSetupDuration: SETUP_MS,
			prepareDuration: SETUP_MS,
			collectDuration: SETUP_MS,
			setupDuration: SETUP_MS,
			duration,
		}),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('unit_file_reporter.slowest_files — the files a run spent longest on', () => {
	it('names the slowest file first, relative to the root, setup and import time included', () => {
		const files = unit_file_reporter.slowest_files(
			[timed('quick.test.ts', 1), timed(STALLED, SLOW_MS)],
			ROOT,
		)

		expect(files[0]).toStrictEqual({ file: STALLED, elapsed_ms: SLOW_MS + SETUP_MS * SETUP_PHASES })
	})

	it('keeps only the slowest few', () => {
		const modules = Array.from({ length: unit_file_reporter.SLOWEST_COUNT + 3 }, (_, index) =>
			timed(`file-${String(index)}.test.ts`, index),
		)

		expect(unit_file_reporter.slowest_files(modules, ROOT)).toHaveLength(
			unit_file_reporter.SLOWEST_COUNT,
		)
	})
})

describe('unit_file_reporter.report — the run end', () => {
	it('hands the slowest files to the sink, relative to the working directory', async () => {
		const sink = vi.fn(async (): Promise<void> => {
			await Promise.resolve()
		})

		await unit_file_reporter.report([timed(STALLED, SLOW_MS, process.cwd())], sink)

		expect(sink).toHaveBeenCalledWith([
			{ file: STALLED, elapsed_ms: SLOW_MS + SETUP_MS * SETUP_PHASES },
		])
	})

	it('records nothing for a run that ran no file', async () => {
		const sink = vi.fn(async (): Promise<void> => {
			await Promise.resolve()
		})

		await unit_file_reporter.report([], sink)

		expect(sink).not.toHaveBeenCalled()
	})
})

describe('unit_file_reporter.record_to_ledger — the ledger it writes', () => {
	it('appends to the ledger of the repository the run is in', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
		const record = vi.spyOn(lane_ledger, 'record_unit_files').mockResolvedValue()
		const files = [{ file: STALLED, elapsed_ms: SLOW_MS }]

		await unit_file_reporter.record_to_ledger(files)

		expect(record).toHaveBeenCalledWith(files, lane_ledger.target_of(REPOSITORY))
	})

	it('writes nothing, and does not throw, outside a repository', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(new Error('not a git repository'))
		const record = vi.spyOn(lane_ledger, 'record_unit_files').mockResolvedValue()

		await expect(unit_file_reporter.record_to_ledger([])).resolves.toBeUndefined()
		expect(record).not.toHaveBeenCalled()
	})
})
