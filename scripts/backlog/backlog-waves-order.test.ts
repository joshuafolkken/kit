import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'
import { backlog_rank, type GateScope } from './backlog-rank'
import { backlog_waves } from './backlog-waves'

// joshuafolkken/kit#5299: on 2026-10-28 `backlog:plan`'s "Ready now" listed joshuafolkken/kit#5316 ahead of
// joshuafolkken/kit#5319, yet wave 2 offered #5319 first — the waves put a yielded issue ahead of the rank and
// "Ready now" did not. Each wave reads in "Ready now"'s order once both walk the offer's order.

const { REPO } = backlog_fixture
const FIRST = 5316
const SECOND = 5290
const YIELDED = 5319
const FOURTH = 5288
const LANE_LIMIT = 2
const SHARED_PATH = 'scripts/run/ship/run-ship-sync.ts'

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker, state: 'OPEN' })),
	}
}

function result(
	candidates: ReadonlyArray<EpicChild>,
	waiting: ReadonlyArray<EpicChild> = [],
): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo: REPO, children: candidates }],
		waiting,
		blocked_on_people: [],
		anomalies: [],
	}
}

function numbers_of(children: ReadonlyArray<EpicChild>): Array<number> {
	return children.map((entry) => entry.number)
}

// Every row standalone, so the lane limit caps each wave.
function keys_of(children: ReadonlyArray<EpicChild>): ReadonlySet<string> {
	return new Set(children.map((entry) => epic_graph.key_of(entry)))
}

function waves_of(input: EpicNextResult, scope: GateScope): Array<Array<number>> {
	return backlog_waves.build(input, REPO, scope).waves.map((wave) => numbers_of(wave))
}

// Each wave keeps the relative order of the list it is read against.
function in_order_of(wave: ReadonlyArray<number>, order: ReadonlyArray<number>): boolean {
	const positions = wave.map((number) => order.indexOf(number))

	if (positions.includes(-1)) return false

	return positions.every((position, index) => index === 0 || position > (positions[index - 1] ?? 0))
}

// The yielded issue shares a declared path with the issue ranked first, so the separation moves that
// one to the next wave.
function yield_scope(ranked: ReadonlyArray<EpicChild>, yielded: ReadonlySet<string>): GateScope {
	const declared = backlog_overlap.declared_of([
		{ number: FIRST, body: `- \`${SHARED_PATH}\` を直す` },
		{ number: YIELDED, body: `- \`${SHARED_PATH}\` を読む` },
	])

	return { standalone: keys_of(ranked), declared, yielded, wave_limit: LANE_LIMIT }
}

describe('backlog_rank.offer_order — "Ready now" in the order each wave is offered in', () => {
	const ranked = [child(FIRST), child(SECOND), child(YIELDED), child(FOURTH)]
	const yielded = new Set([epic_graph.key_of(child(YIELDED))])
	const scope = yield_scope(ranked, yielded)

	it('puts the yielded issue ahead of the rank, the rest in rank order', () => {
		const ordered = backlog_rank.offer_order(result(ranked), REPO, yielded)

		expect(numbers_of(epic_report.candidates_for_repo(ordered, REPO))).toStrictEqual([
			YIELDED,
			FIRST,
			SECOND,
			FOURTH,
		])
	})

	it('lists every wave in the order "Ready now" prints', () => {
		const ordered = backlog_rank.offer_order(result(ranked), REPO, yielded)
		const ready = numbers_of(epic_report.candidates_for_repo(ordered, REPO))
		const waves = waves_of(result(ranked), scope)

		expect(waves).toStrictEqual([
			[YIELDED, SECOND],
			[FIRST, FOURTH],
		])
		expect(waves.every((wave) => in_order_of(wave, ready))).toBe(true)
	})

	it('returns a result with no run verdict as it came', () => {
		const unusable: EpicNextResult = { ...result(ranked), verdict: 'error' }

		expect(backlog_rank.offer_order(unusable, REPO, yielded)).toBe(unusable)
	})

	it('leaves the rank untouched when no issue yielded', () => {
		const ordered = backlog_rank.offer_order(result(ranked), REPO)

		expect(epic_report.candidates_for_repo(ordered, REPO)).toStrictEqual(ranked)
	})
})

// The 2026-10-28 pool's shape: tied ready issues past the lane limit beside a chain that releases a
// tied issue mid-plan. A ready issue that declares nothing never falls behind a tied one ranked after it.
describe('backlog_waves.build — tied ready issues across waves', () => {
	const READY = [5287, 5286, 5284, 5283, 5275]
	const RELEASED = 5276

	it('keeps tied ready issues in their rank order, the released one after them', () => {
		const ready = READY.map((number) => child(number))
		const released = child(RELEASED, [READY[0] ?? 0])
		const input = result(ready, [released])
		const standalone = keys_of([...ready, released])
		const scope: GateScope = { standalone, declared: new Map(), wave_limit: LANE_LIMIT }

		expect(waves_of(input, scope)).toStrictEqual([
			[5287, 5286],
			[5284, 5283],
			[5275, RELEASED],
		])
	})
})
