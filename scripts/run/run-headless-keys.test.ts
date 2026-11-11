import { run_headless } from '#scripts/run/run-headless'
import { describe, expect, it } from 'vitest'
import { run_headless_keys } from './run-headless-keys'

const { BESIDE_CHILD_KEY, HANDOFF_CHILD_KEY, HEADLESS_ENV_KEY, MARK_KEYS } = run_headless_keys

// joshuafolkken/kit#7309: the unit environment blanks `MARK_KEYS`, so every mark the run writes is on it.
describe('run_headless_keys.MARK_KEYS — the run marks the unit environment blanks', () => {
	it('lists the headless, hand-off and beside marks', () => {
		expect(MARK_KEYS).toStrictEqual([HEADLESS_ENV_KEY, HANDOFF_CHILD_KEY, BESIDE_CHILD_KEY])
	})

	it('covers every key the run writes into a launch environment', () => {
		const written = Object.keys({
			...run_headless.beside_environment(),
			...run_headless.handoff_child_environment(),
		})

		expect(written.filter((key) => !MARK_KEYS.includes(key))).toStrictEqual([])
	})
})
