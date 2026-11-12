import { describe, expect, it } from 'vitest'
import { lane_implement_read } from './lane-implement-read'
import type { PausedSpans } from './lane-paused-spans'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#6188: the implement's `read` sub-stage had no breakdown, so what its median 9.5
// minutes went on — the tools, the turns between them, or re-reading the investigated files — was unread.

const MINUTE_MS = 60_000
const LANE = '/home/.claude/projects/-kit-lanes-6188'
const WINDOW = { since_ms: 0, until_ms: 1000 * MINUTE_MS }
const NO_PAUSE: PausedSpans = new Map()
const CITED = '/repo/scripts/lane/cited.ts'
const INVESTIGATOR = { type: 'investigator', model: undefined }

// A call that starts at `start` minutes and runs for one minute.
function call(start: number, fields: Partial<ToolCall>): ToolCall {
	return {
		session_id: 'session-1',
		lane: LANE,
		started_ms: start * MINUTE_MS,
		duration_ms: MINUTE_MS,
		tool: 'Bash',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
		...fields,
	}
}

const LANE_CALLS = [
	call(0, {
		tool: 'Agent',
		subagent: INVESTIGATOR,
		output: 'See `scripts/lane/cited.ts:41` and 12:30, not a path.',
	}),
	call(2, { tool: 'Edit' }),
	call(5, { tool: 'Read', file_path: CITED }),
	call(7, { tool: 'Read', file_path: CITED }),
	call(9, { tool: 'Read', file_path: '/repo/scripts/lane/other.ts' }),
	call(11, { tool: 'Grep' }),
	call(13, { command: 'pnpm josh ship' }),
]

function read_row(calls: ReadonlyArray<ToolCall>): string | undefined {
	return lane_implement_read.table(calls, WINDOW, NO_PAUSE).split('\n').at(-1)
}

describe('lane_implement_read.table', () => {
	it('prints the read breakdown columns', () => {
		expect(lane_implement_read.table(LANE_CALLS, WINDOW, NO_PAUSE)).toContain(
			'| implement read | lanes | tool (min) | thinking (min) | files read | investigator-cited |',
		)
	})

	it('splits the read spans into tool time and the turns before the calls', () => {
		// Four timed read calls, each after a gap since the previous call's end.
		expect(read_row(LANE_CALLS)).toMatch(/^\| read \| 1 \| 4(?:\.0)? \| 5(?:\.0)? \|/u)
	})

	it('counts the distinct files read and those an investigator cited by path:line', () => {
		expect(read_row(LANE_CALLS)).toMatch(/\| 2 \| 1 \|$/u)
	})

	it('cites nothing for a subagent that is not an investigator', () => {
		const calls = LANE_CALLS.map((entry) =>
			entry.subagent === undefined
				? entry
				: { ...entry, subagent: { ...INVESTIGATOR, type: 'Explore' } },
		)

		expect(read_row(calls)).toMatch(/\| 2 \| 0 \|$/u)
	})

	it('cites a bold or ./-led path:line', () => {
		const calls = LANE_CALLS.map((entry) =>
			entry.subagent === undefined
				? entry
				: { ...entry, output: '**./scripts/lane/cited.ts:41** — the guard' },
		)

		expect(read_row(calls)).toMatch(/\| 2 \| 1 \|$/u)
	})

	it('cites a bare file name with an approximate line', () => {
		const calls = LANE_CALLS.map((entry) =>
			entry.subagent === undefined ? entry : { ...entry, output: `${entry.output} other.ts:~9` },
		)

		expect(read_row(calls)).toMatch(/\| 2 \| 2 \|$/u)
	})
})
