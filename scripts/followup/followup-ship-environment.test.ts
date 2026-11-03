import { describe, expect, it } from 'vitest'
import { followup_ship_environment } from './followup-ship-environment'

const { SHIPPED_ENVIRONMENT, is_ship_run } = followup_ship_environment

describe('followup_ship_environment — the mark a ship-run followup carries', () => {
	it('reads the environment a ship sets as a ship run', () => {
		expect(is_ship_run({ ...SHIPPED_ENVIRONMENT })).toBe(true)
	})

	it('reads an environment without the mark as a session run', () => {
		expect(is_ship_run({})).toBe(false)
	})
})
