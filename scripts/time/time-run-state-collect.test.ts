import type { SessionFile } from '#scripts/cost-runtime/cost-transcript'
import type { RunWake } from '#scripts/run/run-wake'
import { describe, expect, it } from 'vitest'
import { time_run_state_collect } from './time-run-state-collect'
import { time_transcript_fixture } from './time-transcript-fixture'

const { span } = time_transcript_fixture
const AT_ISO = '2026-09-13T10:18:00.000Z'
const AT_MS = Date.parse(AT_ISO)

// The cost of a whiff is `cost_pricing.cost_of`, which prices an empty record set at zero — the
// pricing arithmetic itself is fixed by `time-run-state`'s tally test. Here the point is that a whiff
// is priced and stamped, and a non-whiff is dropped.
describe('time_run_state_collect.to_whiff', () => {
	it('prices and stamps a session that did no work', () => {
		const whiff = time_run_state_collect.to_whiff([span('Bash', 1, 1)], [], AT_MS)

		expect(whiff).toEqual({ at: AT_ISO, cost_usd: 0 })
	})

	it('drops a session that made an edit', () => {
		expect(time_run_state_collect.to_whiff([span('Write', 1, 1)], [], AT_MS)).toBeUndefined()
	})
})

function file(session_id: string, modified_ms: number): SessionFile {
	return {
		session_id,
		path: `/tmp/${session_id}.jsonl`,
		modified_ms,
		is_delegated: false,
		depth: 0,
	}
}

const WAKE_START = '2026-09-13T10:10:00.000Z'

function wake(): RunWake {
	return { invocation: 'backlogrun', started_at: WAKE_START, pid: 1, woke: 0 }
}

describe('time_run_state_collect.collect_whiffs', () => {
	it('finds no whiff without a wake supervisor to have spawned one', () => {
		expect(time_run_state_collect.collect_whiffs([file('a', AT_MS)], undefined)).toEqual([])
	})

	it('ignores sessions that predate the supervisor', () => {
		const before = Date.parse('2026-09-13T09:00:00.000Z')

		expect(time_run_state_collect.collect_whiffs([file('old', before)], wake())).toEqual([])
	})
})
