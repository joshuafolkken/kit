import { epic_cross_repo } from '#scripts/epic/epic-cross-repo'
import type { EpicChild, IssueReference } from '#scripts/epic/epic-graph'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import { epic_solo } from '#scripts/epic/epic-solo'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_plan, type PlanContext } from './backlog-plan'
import { backlog_waves } from './backlog-waves'

// joshuafolkken/kit#2778: the order a `backlogrun` takes, wave by wave, assuming every wave merges
// before the next one starts.

const { REPO } = backlog_fixture
const OTHER_REPO = 'joshuafolkken/app-kit'
const FIRST = 2774
const SECOND = 2769
const THIRD = 2766
const SOLO_FIRST = 2770
const SOLO_SECOND = 2765
const PARKED = 2790
const RUNNING = 2791

const CONTEXT: PlanContext = { repo: REPO, titles: new Map(), open_numbers: undefined }

interface ChildSpec {
	labels?: ReadonlyArray<string>
	blocked_by?: ReadonlyArray<number>
	repo?: string
}

function child(number: number, spec: ChildSpec = {}): EpicChild {
	const repo = spec.repo ?? REPO

	return {
		number,
		repo,
		state: 'OPEN',
		labels: spec.labels ?? [],
		blocked_by: (spec.blocked_by ?? []).map((blocker) => ({
			repo,
			number: blocker,
			state: 'OPEN',
		})),
	}
}

function solo(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return child(number, { labels: [RUN_SOLO_LABEL], blocked_by })
}

function result(
	candidates: ReadonlyArray<EpicChild>,
	waiting: ReadonlyArray<EpicChild> = [],
	blocked_on_people: ReadonlyArray<EpicChild> = [],
): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo: REPO, children: candidates }],
		waiting,
		blocked_on_people,
		anomalies: [],
	}
}

function waves_of(input: EpicNextResult): Array<Array<number>> {
	return backlog_waves.build(input, REPO).waves.map((wave) => wave.map((entry) => entry.number))
}

function unreached_of(input: EpicNextResult): Array<number> {
	return backlog_waves.build(input, REPO).unreached.map((entry) => entry.number)
}

describe('backlog_waves.build', () => {
	it('walks a blocked-by chain one wave per link', () => {
		const input = result(
			[child(FIRST)],
			[child(SECOND, { blocked_by: [FIRST] }), child(THIRD, { blocked_by: [SECOND] })],
		)

		expect(waves_of(input)).toStrictEqual([[FIRST], [SECOND], [THIRD]])
	})

	it('runs a leading run:solo issue alone, then the rest in parallel', () => {
		const input = result([solo(SOLO_FIRST), child(FIRST), child(SECOND)])

		expect(waves_of(input)).toStrictEqual([[SOLO_FIRST], [FIRST, SECOND]])
	})

	it('cuts a later wave at a run:solo issue that becomes ready in it', () => {
		const input = result(
			[child(FIRST)],
			[child(SECOND, { blocked_by: [FIRST] }), solo(SOLO_FIRST, [FIRST])],
		)

		expect(waves_of(input)).toStrictEqual([[FIRST], [SOLO_FIRST], [SECOND]])
	})

	it('gives each of two run:solo issues its own wave', () => {
		const input = result([solo(SOLO_FIRST), solo(SOLO_SECOND), child(FIRST)])

		expect(waves_of(input)).toStrictEqual([[SOLO_FIRST], [SOLO_SECOND], [FIRST]])
	})
})

describe('backlog_waves.build — run:solo issues across the backlog', () => {
	it('plans the current backlog in three waves, run:solo issues first', () => {
		const ranked = [child(FIRST), solo(SOLO_FIRST), solo(SOLO_SECOND), child(SECOND), child(THIRD)]

		expect(waves_of(result(ranked))).toStrictEqual([
			[SOLO_FIRST],
			[SOLO_SECOND],
			[FIRST, SECOND, THIRD],
		])
	})

	it('matches what backlog:next offers an idle repository in its first wave', () => {
		const input = result([child(FIRST), solo(SOLO_FIRST), child(SECOND)])
		const offered = epic_report.candidates_for_repo(
			epic_solo.gate(input, { kind: 'idle' }, REPO).result,
			REPO,
		)

		expect(backlog_waves.build(input, REPO).waves[0]).toStrictEqual(offered)
	})
})

describe('backlog_waves.build — issues no wave reaches', () => {
	it('leaves a parked issue and the issue behind it unreached', () => {
		const parked = child(PARKED, { labels: [NEEDS_DECISION_LABEL] })
		const input = result([child(FIRST)], [], [parked, child(SECOND, { blocked_by: [PARKED] })])

		expect(waves_of(input)).toStrictEqual([[FIRST]])
		expect(unreached_of(input)).toStrictEqual([PARKED, SECOND])
	})

	it('leaves a running issue out of the waves, and the issue behind it waiting on it', () => {
		const running = child(RUNNING, { labels: [IN_PROGRESS_LABEL] })
		const input = result([child(FIRST)], [running, child(SECOND, { blocked_by: [RUNNING] })])

		expect(waves_of(input)).toStrictEqual([[FIRST]])
		expect(unreached_of(input)).toStrictEqual([RUNNING, SECOND])
	})

	it('keeps an issue behind a closed but unpublished blocker in another repository waiting', () => {
		const resolve = epic_cross_repo.resolve_cross_repo

		vi.spyOn(epic_cross_repo, 'resolve_cross_repo').mockImplementation((blocker, blocked) =>
			blocker.repo === blocked.repo ? resolve(blocker, blocked) : 'time',
		)
		const released: IssueReference = { repo: OTHER_REPO, number: PARKED, state: 'CLOSED' }
		const behind: EpicChild = { ...child(THIRD), blocked_by: [released] }
		const input = result([child(FIRST)], [child(SECOND, { blocked_by: [FIRST] }), behind])

		expect(waves_of(input)).toStrictEqual([[FIRST], [SECOND]])
		expect(unreached_of(input)).toStrictEqual([THIRD])
		vi.restoreAllMocks()
	})

	it('plans only this repository, leaving another repository out of both lists', () => {
		const input = result([child(FIRST)], [child(SECOND, { repo: OTHER_REPO })])

		expect(waves_of(input)).toStrictEqual([[FIRST]])
		expect(unreached_of(input)).toStrictEqual([])
	})
})

describe('backlog_waves.format_waves', () => {
	it('prints the assumption, one line per wave, and the parallel note', () => {
		const text = backlog_waves.format_waves(
			result([solo(SOLO_FIRST), child(FIRST), child(SECOND)]),
			CONTEXT,
		)

		expect(text).toContain(backlog_waves.HEADING_ASSUMPTION)
		expect(text).toContain(`Wave 1  #${String(SOLO_FIRST)} ${backlog_plan.SOLO_MARK}\n`)
		expect(text).toContain(
			`Wave 2  #${String(FIRST)} #${String(SECOND)}   ${backlog_waves.PARALLEL_NOTE}`,
		)
	})

	it('names what each unreached issue waits on', () => {
		const parked = child(PARKED, { labels: [NEEDS_DECISION_LABEL] })
		const input = result([child(FIRST)], [], [parked, child(SECOND, { blocked_by: [PARKED] })])
		const text = backlog_waves.format_waves(input, CONTEXT)

		expect(text).toContain(backlog_waves.UNREACHED_HEADING)
		expect(text).toContain(`#${String(PARKED)}  — ${backlog_waves.NEEDS_DECISION_NOTE}`)
		expect(text).toContain(`#${String(SECOND)}  — waiting on #${String(PARKED)}`)
	})

	it('prints the unusable-graph report instead of waves for an error verdict', () => {
		const input: EpicNextResult = { ...result([]), verdict: 'error' }

		expect(backlog_waves.format_waves(input, CONTEXT)).toContain(backlog_plan.UNUSABLE_HEADING)
	})
})
