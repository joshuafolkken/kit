import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unit_duration_record } from './unit-duration-record'
import type { TimedModule } from './unit-file-reporter'

// joshuafolkken/kit#4467: the per-file durations the CI unit shards are balanced by.

const KEPT = 'kept.test.ts'
const GONE = 'gone.test.ts'
const MEASURED = 'measured.test.ts'
const MEASURED_MS = 40
const OLD_MS = 5
const SETUP_MS = 1
const SETUP_PHASES = 4

const directories: Array<string> = []

function repository(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'unit-duration-record-'))

	directories.push(root)
	mkdirSync(path.join(root, 'tools/test'), { recursive: true })

	return root
}

function timed(root: string, file: string, duration: number): TimedModule {
	return {
		moduleId: path.join(root, file),
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
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('unit_duration_record.merge — what a run leaves in the record', () => {
	it('keeps the files it did not run, takes the new time of the ones it did, drops the deleted ones', () => {
		const merged = unit_duration_record.merge(
			{ [KEPT]: OLD_MS, [GONE]: OLD_MS, [MEASURED]: OLD_MS },
			{ [MEASURED]: MEASURED_MS },
			(file) => file !== GONE,
		)

		expect(merged).toStrictEqual({ [KEPT]: OLD_MS, [MEASURED]: MEASURED_MS })
		expect(Object.keys(merged)).toStrictEqual([KEPT, MEASURED])
	})
})

describe('unit_duration_record.parse — the record as read', () => {
	it('keeps the numeric entries and drops anything else', () => {
		expect(unit_duration_record.parse(`{"${KEPT}": 3, "bad": "x"}`)).toStrictEqual({ [KEPT]: 3 })
		expect(unit_duration_record.parse('[]')).toStrictEqual({})
		expect(unit_duration_record.parse('null')).toStrictEqual({})
	})
})

describe('unit_duration_record.read — a missing record', () => {
	it('answers an empty record', () => {
		expect(unit_duration_record.read(repository())).toStrictEqual({})
	})
})

describe('unit_duration_record.write — the run end of a recording run', () => {
	it('writes each run file with its setup and test time, relative to the root', () => {
		const root = repository()

		writeFileSync(path.join(root, MEASURED), '')
		unit_duration_record.write(
			unit_duration_record.measured_of([timed(root, MEASURED, MEASURED_MS)], root),
			root,
		)

		expect(unit_duration_record.read(root)).toStrictEqual({
			[MEASURED]: MEASURED_MS + SETUP_MS * SETUP_PHASES,
		})
		expect(readFileSync(path.join(root, unit_duration_record.RECORD_FILE), 'utf8')).toMatch(/\n$/u)
	})

	it('leaves the record alone after a run that ran no file', () => {
		const root = repository()

		unit_duration_record.write({}, root)

		expect(unit_duration_record.read(root)).toStrictEqual({})
	})
})

describe('unit_duration_record.reporters — recording is opt-in', () => {
	it('adds no reporter to an ordinary run', () => {
		expect(unit_duration_record.reporters({})).toStrictEqual([])
	})

	it('writes nothing at the run end, deferring the write to the process exit', () => {
		const environment = {
			[unit_duration_record.RECORD_FLAG]: unit_duration_record.RECORD_VALUE,
		}
		const once = vi.spyOn(process, 'once').mockReturnValue(process)
		const [reporter] = unit_duration_record.reporters(environment)

		reporter?.onTestRunEnd?.([], [], 'passed')

		expect(once).toHaveBeenCalledWith('exit', expect.any(Function))
	})
})

describe('unit_duration_record.relative_file — the key the record and the sequencer share', () => {
	it('answers the repository-relative path', () => {
		expect(unit_duration_record.relative_file('/repository', '/repository/a/b.test.ts')).toBe(
			'a/b.test.ts',
		)
	})
})
