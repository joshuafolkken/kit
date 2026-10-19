import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { josh_harness } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const { RECORD, SCENARIO_TIMEOUT_MS, ledger_at, ledger_text } = josh_harness_fixture

const environment = josh_harness_fixture.open_environments(['lane'])

josh_harness_fixture.describe_environment('lane', environment)

describe('josh harness — scenarios from past defects', () => {
	it(
		'records a lane review round in the lane, not the primary checkout (#2919)',
		async () => {
			const lane = environment('lane')
			const result = await josh_harness.run(lane, [RECORD, '--issue', '2919'])

			expect(result.exit_code).toBe(0)
			expect(result.stdout).toContain(ledger_at(lane.root, 2919))
			expect(ledger_text(lane.root, 2919)).toContain('#2919')
			expect(existsSync(ledger_at(lane.primary, 2919))).toBe(false)
		},
		SCENARIO_TIMEOUT_MS,
	)
})
