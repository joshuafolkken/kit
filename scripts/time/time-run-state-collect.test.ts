import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import type { RunWake } from '#scripts/run/run-wake'
import { describe, expect, it } from 'vitest'
import { time_run_state_collect } from './time-run-state-collect'
import { time_transcript_fixture } from './time-transcript-fixture'

const { span, issue_lines, project_directory, write_session } = time_transcript_fixture
const AT_ISO = '2026-09-13T10:18:00.000Z'
const AT_MS = Date.parse(AT_ISO)
// A second stamp, so a filter that priced the wrong session would return a different `at`.
const UNRELATED_MS = Date.parse('2026-09-13T10:25:00.000Z')

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

// A read-only session written to disk, so `whiff_of` reads a real transcript rather than a missing one.
function on_disk(home: string, session_id: string, modified_ms: number): SessionFile {
	write_session(home, session_id, issue_lines(0))

	return {
		...file(session_id, modified_ms),
		path: path.join(
			project_directory(home),
			`${session_id}${cost_transcript.TRANSCRIPT_EXTENSION}`,
		),
	}
}

const WAKE_START = '2026-09-13T10:10:00.000Z'
const SPAWNED_ID = '33333333-3333-4333-8333-333333333333'
const UNRELATED_ID = 'unrelated-read-only-session'

function wake(spawned?: ReadonlyArray<string>): RunWake {
	return {
		invocation: 'backlogrun',
		started_at: WAKE_START,
		pid: 1,
		woke: 0,
		...(spawned && { spawned }),
	}
}

// joshuafolkken/kit#2407. A whiff is a session the supervisor forced with `--session-id`, not any
// transcript that moved while it was alive. These fix the attribution boundary; the pricing of a
// session inside it is `to_whiff`'s, above.
describe('time_run_state_collect.collect_whiffs', () => {
	it('finds no whiff without a wake supervisor to have spawned one', () => {
		expect(time_run_state_collect.collect_whiffs([file('a', AT_MS)], undefined)).toEqual([])
	})

	it('counts nothing while the supervisor has forced no session ids yet', () => {
		expect(time_run_state_collect.collect_whiffs([file('a', AT_MS)], wake())).toEqual([])
	})

	// The session that filed #2407 met the old condition — a read-only session that moved while the
	// supervisor was alive — and was priced as a whiff. It is not one the supervisor spawned, so it is
	// no longer counted, however recently it moved.
	it('ignores a session the supervisor never started, however recently it moved', () => {
		const unrelated = file(UNRELATED_ID, AT_MS)

		expect(time_run_state_collect.collect_whiffs([unrelated], wake([SPAWNED_ID]))).toEqual([])
	})

	// The positive half of the boundary: two read-only transcripts on disk, both genuine whiffs, and
	// only the one whose id the supervisor forced is priced. An always-empty or inverted filter fails.
	it('prices the whiff of a session the supervisor started, and only that one', () => {
		const home = mkdtempSync(path.join(os.tmpdir(), 'collect-whiffs-'))
		const spawned = on_disk(home, SPAWNED_ID, AT_MS)
		const unrelated = on_disk(home, UNRELATED_ID, UNRELATED_MS)

		expect(time_run_state_collect.collect_whiffs([spawned, unrelated], wake([SPAWNED_ID]))).toEqual(
			[{ at: AT_ISO, cost_usd: 0 }],
		)
	})
})
