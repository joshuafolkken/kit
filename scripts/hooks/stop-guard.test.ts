import { stop_rules } from '#scripts/rules/stop-rules'
import { afterEach, describe, expect, it } from 'vitest'
import { stop_guard } from './stop-guard'

const SWITCH_KEY = stop_rules.SWITCH_ENV_KEY

afterEach(() => {
	Reflect.deleteProperty(process.env, SWITCH_KEY)
})

describe('stop_guard — fail open', () => {
	it('returns no outcome on a payload that is not JSON', async () => {
		expect(await stop_guard.outcome_of('not json')).toEqual(stop_rules.NO_OUTCOME)
	})

	it('returns no outcome when the guard switch is off, before any world read', async () => {
		process.env[SWITCH_KEY] = 'off'
		const payload = JSON.stringify({
			transcript_path: 'transcript-not-read',
			stop_hook_active: true,
		})

		expect(await stop_guard.stop_outcome_for_payload(payload)).toEqual(stop_rules.NO_OUTCOME)
	})
})
