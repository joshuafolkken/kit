import { describe, expect, it } from 'vitest'
import { run_ship } from './run-ship'
import { run_ship_pre_detach } from './run-ship-pre-detach'
import { run_ship_stop_cause } from './run-ship-stop-cause'

// joshuafolkken/kit#7552: the path a pre-detach `unpinned` stop took reaches the ledger's stop record,
// from the pinned check through the preflight's stop section.

const GREEN = { code: 0, out: 'ok\n' }
const UNPINNED = { path: 'new-site', hunks: 2 } as const
const RED_PINNED = { code: 1, out: 'unpinned\n', unpinned: UNPINNED }
const PREFLIGHT = { header: run_ship.PREFLIGHT_HEADER, body: 'ok', code: 0 }

describe('the path of an unpinned stop', () => {
	it('carries the red pinned check’s path beside its unpinned precondition', () => {
		expect(run_ship_pre_detach.with_pinned(GREEN, RED_PINNED)).toStrictEqual({
			code: 1,
			out: 'unpinned\n',
			preconditions: ['unpinned'],
			unpinned: UNPINNED,
		})
	})

	it('carries no path where the pinned check passed', () => {
		const red = { code: 1, out: 'type error\n' }

		expect(run_ship_pre_detach.with_pinned(red, GREEN)).toStrictEqual({
			...red,
			preconditions: ['pre-detach'],
		})
	})

	it('adds the path to the preflight stop section', () => {
		const checks = run_ship_pre_detach.with_pinned(GREEN, RED_PINNED)

		expect(run_ship.with_checks(PREFLIGHT, checks)).toMatchObject({
			preconditions: ['unpinned'],
			unpinned: UNPINNED,
		})
	})

	it('records the path in the stop record', () => {
		const failed = { body: 'unpinned', preconditions: ['unpinned'], unpinned: UNPINNED }

		expect(run_ship_stop_cause.record_of(7552, 'preflight', failed)).toStrictEqual({
			issue: 7552,
			reason: 'preflight',
			cause: 'check',
			preconditions: ['unpinned'],
			unpinned: UNPINNED,
		})
	})
})
