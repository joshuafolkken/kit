import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import type { LedgerEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#5755: #5635's between ship stages had most of its time under no row — its yield
// note had no closing withdrawal, so the wait for its redispatch counted as lane time, and the time no
// Bash covered had no row. The fixture is #5635's event stream, ledger and Bash calls between ship
// stages, in seconds from its first dispatch.

const ISSUE = 5635
const LANE = `#${String(ISSUE)}`
const START = Date.parse('2026-11-01T12:18:17.983Z')
const MS_PER_SECOND = 1000
const MINUTE_MS = 60_000
const UNATTRIBUTED_CAP_MS = 2 * MINUTE_MS
// The yield note to the redispatch.
const YIELD_MS = (3325 - 2320) * MS_PER_SECOND
const SHIP_STAGE = 'ship-stage'
const LANE_PHASE = 'lane-phase'

const ENTRIES: ReadonlyArray<readonly [string, number]> = [
	['dispatch', 0],
	['dispatch', 3325],
	['merge', 4091],
]

// `<second> <stage> <phase>`, one ship-stage event a line.
const SHIP_STAGES = `
1453 preflight start
1701 preflight failed
1761 preflight start
1864 preflight done
1869 pre-detach start
1923 pre-detach done
1928 preflight start
1942 preflight done
1942 sync start
1996 sync done
2007 preflight skipped
2007 sync start
2013 sync done
2016 review start
2021 review skipped
2025 gate start
2025 round-2 start
2126 gate failed
2135 round-2 failed
2210 preflight start
2212 preflight failed
2216 pre-detach start
2293 pre-detach done
3361 preflight start
3452 preflight done
3457 pre-detach start
3521 pre-detach done
3526 preflight start
3539 preflight done
3539 sync start
3566 sync done
3574 preflight skipped
3575 sync start
3579 sync done
3582 gate start
3743 gate done
3743 commit start
3822 commit done
3822 followup start
4052 followup done
4052 report start
4059 report done
`

const LANE_EVENTS: ReadonlyArray<readonly [number, string, string]> = [
	[302, 'plan', 'planned'],
	[302, LANE_PHASE, 'implement'],
	[1321, 'cut', 'cut (implementation)'],
	[1330, 'resume', 'resumed'],
	[1343, LANE_PHASE, 'implement'],
	[2136, 'ship-stop', 'round-2 failed (check)'],
	[2320, 'note', 'yielded its lane: its planned file overlaps #5633 · at: summary'],
	[4091, 'merge', 'merged'],
]

// The lane child's Bash calls between ship stages: started, seconds run, command.
const CALLS: ReadonlyArray<readonly [number, number, string]> = [
	[1706, 0, 'git diff --stat main...HEAD -- scripts/test/'],
	[1710, 38, 'pnpm josh reserved-run 1 -- vitest run scripts/test'],
	[1755, 168, 'pnpm josh ship --detach --review'],
	[1927, 3, 'pnpm josh cost --cut'],
	[2141, 7, 'rm /tmp/josh-tree-verdict-lint-related.json'],
	[2152, 0, 'git diff main -- docs/josh-commands-run.md'],
	[2159, 0, 'grep -n josh-commands-run scripts/document'],
	[2166, 36, 'pnpm josh lint:related && pnpm josh test:related --touched'],
	[2206, 88, 'pnpm josh ship --detach --body-file body.md'],
	[2298, 23, 'pnpm josh lane:plan 5635 scripts/run/stale/run-stale.ts'],
	[3332, 6, 'git status --short && pnpm josh run:step 5635'],
	[3343, 2, 'pnpm josh issue:read 5635'],
	[3349, 3, 'pnpm josh ship --log 5635'],
	[3356, 166, 'pnpm josh ship --detach --cite 5635'],
]

function at(second: number): string {
	return new Date(START + second * MS_PER_SECOND).toISOString()
}

function entries_5635(): Array<LedgerEntry> {
	return ENTRIES.map(([kind, second]) =>
		kind === 'merge'
			? { kind: 'merge', at: at(second), issue: ISSUE }
			: { kind: 'dispatch', at: at(second), issue: ISSUE },
	)
}

function ship_stages(): Array<readonly [number, string, string]> {
	return SHIP_STAGES.trim()
		.split('\n')
		.map((line) => {
			const [second = '', ...words] = line.split(' ')

			return [Number(second), SHIP_STAGE, words.join(' ')] as const
		})
}

function events_5635(): Array<RunEvent> {
	const all = [...LANE_EVENTS, ...ship_stages()].toSorted(([left], [right]) => left - right)

	return all.map(([second, kind, text], pos) => ({
		pos,
		at: at(second),
		kind,
		text: `${LANE} ${text}`,
	}))
}

function calls_5635(): Array<ToolCall> {
	return CALLS.map(([second, seconds, command]) => ({
		session_id: 's',
		lane: String(ISSUE),
		started_ms: START + second * MS_PER_SECOND,
		duration_ms: seconds * MS_PER_SECOND,
		tool: 'Bash',
		background: false,
		command,
		subagent: undefined,
		output: '',
	}))
}

function sum_ms(parts: ReadonlyArray<Stage>): number {
	return parts.reduce((sum, part) => sum + part.ms, 0)
}

describe('lane_breakdown — #5635 between ship stages', () => {
	it('takes the yield out and leaves at most 2 minutes of it without a row', () => {
		const entries = entries_5635()
		const breakdown = lane_breakdown.of(entries, events_5635(), ISSUE)

		if (breakdown === undefined) throw new Error('no breakdown of #5635')
		const between = breakdown.stages.find((stage) => stage.name === lane_breakdown.BETWEEN_STAGE)
		const laps = lane_breakdown_laps.of(entries, ISSUE, breakdown, calls_5635())
		const rows_ms = sum_ms(laps.get(lane_breakdown.BETWEEN_STAGE) ?? [])

		expect(breakdown.yield_ms).toBe(YIELD_MS)
		expect(Math.max(0, (between?.ms ?? 0) - rows_ms)).toBeLessThanOrEqual(UNATTRIBUTED_CAP_MS)
	})
})
