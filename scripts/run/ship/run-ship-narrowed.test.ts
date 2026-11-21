import { gate_labels } from '#scripts/gate/gate-labels'
import type { FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_narrowed } from './run-ship-narrowed'
import type { SyncedCheck } from './run-ship-synced-scope'

const josh_run_mock = vi.hoisted(() => vi.fn())
const record_mock = vi.hoisted(() => vi.fn())
const missing_mock = vi.hoisted(() => vi.fn())
const briefed_read_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { record_green: record_mock, missing_scripts: missing_mock },
}))
vi.mock('#scripts/review/review-stamps', () => ({
	review_stamps: { briefed_stamp: { read: briefed_read_mock } },
}))

// joshuafolkken/kit#5531: a scoped pair the ship can name the moved files of runs over them alone.

const STAMP: FileMapStampAccess = {
	stamp_path: () => '',
	read: () => undefined,
	describes_inputs: () => true,
	write: () => '',
	complete: () => undefined,
	remove: () => undefined,
}
const LINT = 'lint:related'
const TEST = 'test:related'
const CHECKS: ReadonlyArray<SyncedCheck> = [
	{ script: LINT, label: gate_labels.LINT_LABEL, stamp: STAMP },
	{ script: TEST, label: gate_labels.UNIT_LABEL, stamp: STAMP },
]
// Real paths, because a file no longer on disk cannot be named.
const SOURCE = 'scripts/run/ship/run-ship-narrowed.ts'
const OTHER = 'scripts/run/ship/run-ship-scoped.ts'
const ESLINT_CONFIG = 'eslint.config.js'
const RUN_RECORD = '.josh/metrics-accepted/5531.json'
const GREEN = { files: { [SOURCE]: 'a', [OTHER]: 'b', [RUN_RECORD]: 'c' }, base: 'base' }

beforeEach(() => {
	run_ship_narrowed.forget()
	josh_run_mock.mockReset().mockResolvedValue({ code: 0, out: '' })
	record_mock.mockReset()
	missing_mock.mockReset().mockReturnValue([])
	briefed_read_mock.mockReset().mockReturnValue(undefined)
})

const FIXED = { files: { ...GREEN.files, [SOURCE]: 'a2', [RUN_RECORD]: 'c2' }, base: 'base' }

describe('run_ship_narrowed.moved_since_green', () => {
	it('answers the files moved since the remembered green tree, leaving run records out', async () => {
		run_ship_narrowed.remember(GREEN)

		const moved = await run_ship_narrowed.moved_since_green(CHECKS, FIXED)

		expect(moved?.files).toStrictEqual([SOURCE])
		expect(moved?.resumed_from).toBe('none')
	})

	it('answers undefined with no green tree remembered', async () => {
		await expect(run_ship_narrowed.moved_since_green(CHECKS, GREEN)).resolves.toBeUndefined()
	})

	it('answers undefined once a merge moved the base', async () => {
		run_ship_narrowed.remember(GREEN)

		await expect(
			run_ship_narrowed.moved_since_green(CHECKS, { ...GREEN, base: 'merged' }),
		).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#7789: a ship relaunched after a round-2 stop starts from the tree that round read.
describe('run_ship_narrowed.moved_since_green after a round-2 stop', () => {
	beforeEach(() => {
		briefed_read_mock.mockReturnValue({ taken_at: '', ...GREEN })
	})

	it('narrows to the fix and says it resumed from the round-2 fix (ac-d355a259)', async () => {
		const moved = await run_ship_narrowed.moved_since_green(CHECKS, FIXED)

		expect(moved?.files).toStrictEqual([SOURCE])
		expect(moved?.resumed_from).toBe('round-2-fix')
		expect(moved?.why).toContain('resumed from the round-2 fix')
		expect(missing_mock).toHaveBeenCalledWith(GREEN.files, GREEN.base)
	})

	it('starts over when the records do not vouch for the round-2 tree (ac-bd2b9ce0)', async () => {
		missing_mock.mockReturnValue([LINT])

		await expect(run_ship_narrowed.moved_since_green(CHECKS, FIXED)).resolves.toBeUndefined()
	})

	it('starts over once main moved the base since round 2 (ac-80717c69)', async () => {
		await expect(
			run_ship_narrowed.moved_since_green(CHECKS, { ...FIXED, base: 'merged' }),
		).resolves.toBeUndefined()
	})

	it.each([
		['no briefed tree', undefined],
		['a briefed tree with no base', { taken_at: '', files: GREEN.files }],
	])('starts over with %s', async (_label, briefed) => {
		briefed_read_mock.mockReturnValue(briefed)

		await expect(run_ship_narrowed.moved_since_green(CHECKS, FIXED)).resolves.toBeUndefined()
	})

	it('prefers the tree this process met green over the round-2 tree', async () => {
		run_ship_narrowed.remember(GREEN)

		await expect(run_ship_narrowed.moved_since_green(CHECKS, FIXED)).resolves.toMatchObject({
			resumed_from: 'none',
		})
		expect(briefed_read_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_narrowed.nameable', () => {
	it('names files on disk that configure no check', async () => {
		await expect(run_ship_narrowed.nameable(CHECKS, [SOURCE])).resolves.toStrictEqual([SOURCE])
	})

	it('names nothing when a file configures a check', async () => {
		await expect(
			run_ship_narrowed.nameable(CHECKS, [SOURCE, ESLINT_CONFIG]),
		).resolves.toBeUndefined()
	})

	it('names nothing when a file is no longer on disk', async () => {
		await expect(
			run_ship_narrowed.nameable(CHECKS, ['scripts/run/ship/deleted.ts']),
		).resolves.toBeUndefined()
	})
})

describe('run_ship_narrowed.named_phases', () => {
	it('runs each check over the named files, forwarding stderr', async () => {
		for (const phase of run_ship_narrowed.named_phases(CHECKS, [SOURCE])) {
			// eslint-disable-next-line no-await-in-loop -- the phases run in order, as the ship runs them
			await phase()
		}

		expect(josh_run_mock.mock.calls).toStrictEqual([
			[[LINT, SOURCE], true, undefined, {}],
			[[TEST, SOURCE], true, undefined, {}],
		])
	})

	it('runs nothing when nothing is named', () => {
		expect(run_ship_narrowed.named_phases(CHECKS, [])).toStrictEqual([])
	})
})

describe('run_ship_narrowed.record', () => {
	it('records each check green on the tree', () => {
		run_ship_narrowed.record(CHECKS, GREEN)

		expect(record_mock.mock.calls).toStrictEqual([
			[STAMP, GREEN],
			[STAMP, GREEN],
		])
	})
})

describe('run_ship_narrowed.describe', () => {
	it('names how many files the pair narrowed to and why', () => {
		expect(run_ship_narrowed.describe([SOURCE, OTHER], 'moved since green')).toBe(
			'scoped pair: narrowed to the 2 file(s) moved since green.',
		)
	})
})
