import { afterEach, expect, test, vi } from 'vitest'
import { run_carry_session } from './run-carry-session'

const SESSION = 'scheduler-generation'

afterEach(() => vi.unstubAllEnvs())

test('reads the explicit scheduler identity and leaves an absent identity absent', () => {
	vi.stubEnv(run_carry_session.KEY, undefined)
	expect(run_carry_session.own()).toBeUndefined()
	vi.stubEnv(run_carry_session.KEY, SESSION)
	expect(run_carry_session.own()).toBe(SESSION)
})

test.each(['JOSH_LANE_CHILD', 'JOSH_HANDOFF_CHILD', 'JOSH_BESIDE_CHILD'])(
	'keeps a child marked with %s from authenticating as its scheduler',
	(key) => {
		vi.stubEnv(run_carry_session.KEY, SESSION)
		vi.stubEnv(key, '1')
		expect(run_carry_session.own()).toBeUndefined()
	},
)
