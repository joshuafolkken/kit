import { describe, expect, it } from 'vitest'
import { lane_concurrency_wait } from './lane-concurrency-wait'
import type { LedgerEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#7550: a `lint:related` / `test:related` call's core wait is the `core_wait`
// records its own lane wrote for the same command while it ran — none tied reads `undefined`.

const STARTED = Date.parse('2026-11-10T12:00:00.000Z')
const SECOND = 1000
const ISSUE = 7
const OTHER_ISSUE = 8
const LINT = 'lint:related'
const TEST = 'test:related'

function wait(command: string, offset_s: number, waited_s: number, issue?: number): LedgerEntry {
	const at = new Date(STARTED + offset_s * SECOND).toISOString()

	return { kind: 'core-wait', at, command, waited_ms: waited_s * SECOND, issue }
}

function admission(offset_s: number): LedgerEntry {
	const at = new Date(STARTED + offset_s * SECOND).toISOString()

	return { kind: 'core-admission', at, command: LINT, waited_ms: 0, issue: ISSUE }
}

function call(seconds: number, started_s = 0): ToolCall {
	return {
		session_id: 'one',
		lane: `/home/.claude/projects/-kit-lanes-${String(ISSUE)}`,
		started_ms: STARTED + started_s * SECOND,
		duration_ms: seconds * SECOND,
		tool: 'Bash',
		background: false,
		command: `pnpm josh ${LINT}`,
		subagent: undefined,
		output: '',
	}
}

function wait_of(entries: ReadonlyArray<LedgerEntry>, seconds: number): number | undefined {
	const target = call(seconds)

	return lane_concurrency_wait.wait_ms(lane_concurrency_wait.waits_of(entries), LINT, target, [
		target,
	])
}

describe('lane_concurrency_wait.wait_ms', () => {
	it('sums the same lane and command waits recorded while the call ran', () => {
		const entries = [wait(LINT, 1, 3, ISSUE), wait(LINT, 20, 4, ISSUE), wait(LINT, 30, 5, ISSUE)]

		expect(wait_of(entries, 30)).toBe(12 * SECOND)
	})

	it('ties no wait from another lane, another command, no lane or outside the call', () => {
		const entries = [
			wait(LINT, 1, 3, OTHER_ISSUE),
			wait(TEST, 1, 3, ISSUE),
			wait(LINT, 1, 3),
			wait(LINT, -1, 3, ISSUE),
			wait(LINT, 31, 3, ISSUE),
		]

		expect(wait_of(entries, 30)).toBeUndefined()
	})

	it('reads an immediate admission as a measured zero wait', () => {
		expect(wait_of([admission(1)], 30)).toBe(0)
	})

	it('gives each record to one of two overlapping same-lane calls of the command', () => {
		const background = call(60)
		const foreground = call(20, 30)
		const calls = [background, foreground]
		const waits = lane_concurrency_wait.waits_of([
			wait(LINT, 5, 3, ISSUE),
			wait(LINT, 40, 4, ISSUE),
		])

		expect(lane_concurrency_wait.wait_ms(waits, LINT, background, calls)).toBe(3 * SECOND)
		expect(lane_concurrency_wait.wait_ms(waits, LINT, foreground, calls)).toBe(4 * SECOND)
	})
})
