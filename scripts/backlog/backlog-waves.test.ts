import { epic_cross_repo } from '#scripts/epic/epic-cross-repo'
import { epic_graph, type EpicChild, type IssueReference } from '#scripts/epic/epic-graph'
import { epic_report, type EpicNextResult } from '#scripts/epic/epic-report'
import { git_next_issues } from '#scripts/issue/git-next-issues'
import {
	BUG_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'
import { backlog_plan, type PlanContext } from './backlog-plan'
import { backlog_rank, type GateScope } from './backlog-rank'
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
		labels: spec.labels ?? [RUN_LANE_LABEL],
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

// A run:solo issue whose defect reaches the verification path — the one the ranking puts first.
function solo_defect(number: number): EpicChild {
	return child(number, { labels: [BUG_LABEL, RUN_SOLO_LABEL] })
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

afterEach(() => {
	vi.restoreAllMocks()
})

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

		expect(waves_of(input)).toStrictEqual([[FIRST], [SECOND], [SOLO_FIRST]])
	})

	it('gives each of two run:solo issues its own wave', () => {
		const input = result([solo(SOLO_FIRST), solo(SOLO_SECOND), child(FIRST)])

		expect(waves_of(input)).toStrictEqual([[SOLO_FIRST], [SOLO_SECOND], [FIRST]])
	})
})

describe('backlog_waves.build — run:solo issues across the backlog', () => {
	it('plans verification-path defects first, each in its own wave', () => {
		const ranked = [
			child(FIRST),
			solo_defect(SOLO_FIRST),
			solo_defect(SOLO_SECOND),
			child(SECOND),
			child(THIRD),
		]

		expect(waves_of(result(ranked))).toStrictEqual([
			[SOLO_FIRST],
			[SOLO_SECOND],
			[FIRST, SECOND, THIRD],
		])
	})

	// joshuafolkken/kit#2928: run:solo alone means "runs alone", not "runs first".
	it('keeps a run:solo issue that is not a defect in its ranked place', () => {
		const ranked = [child(FIRST), solo(SOLO_FIRST), child(SECOND)]

		expect(waves_of(result(ranked))).toStrictEqual([[FIRST], [SOLO_FIRST], [SECOND]])
	})
})

// joshuafolkken/kit#2928: the plan and the run cut each wave with one selection — rank, run:solo
// gate, cap — so wave 1 is what backlog:next offers an idle repository, past the cap included.
describe('backlog_waves.build — the same offer backlog:next makes', () => {
	const STANDALONE_NUMBERS = [2801, 2802, 2803, 2804, 2805, 2806, 2807]
	const standalone_children = STANDALONE_NUMBERS.map((number) => child(number))
	const keys = new Set(standalone_children.map((entry) => epic_graph.key_of(entry)))

	const scope: GateScope = { standalone: keys, declared: new Map() }

	it('matches what backlog:next offers an idle repository in its first wave', () => {
		const input = result([child(FIRST), solo(SOLO_FIRST), ...standalone_children])
		const offered = epic_report.candidates_for_repo(
			backlog_rank.gate(input, { kind: 'idle' }, REPO, scope).result,
			REPO,
		)

		expect(backlog_waves.build(input, REPO, scope).waves[0]).toStrictEqual(offered)
	})

	it('caps a wave of standalone rows at five, as backlog:next does', () => {
		const wave = backlog_waves.build(result(standalone_children), REPO, scope).waves[0] ?? []

		expect(wave.map((entry) => entry.number)).toStrictEqual(
			STANDALONE_NUMBERS.slice(0, git_next_issues.DISPLAY_LIMIT),
		)
	})
})

// joshuafolkken/kit#3617: two issues that declare the same file are separated in the plan as in
// the run, so wave 1 still matches backlog:next and the second issue moves to the next wave.
describe('backlog_waves.build — issues that declare the same file', () => {
	const SHARED_PATH = 'scripts/run/ship/run-ship.ts'
	const declared = backlog_overlap.declared_of([
		{ number: FIRST, body: `Split \`${SHARED_PATH}\` into two modules.` },
		{ number: SECOND, body: `Move \`${SHARED_PATH}\` under a new directory.` },
	])
	const scope: GateScope = { standalone: new Set(), declared }
	const input = result([child(FIRST), child(SECOND), child(THIRD)])

	it('separates its first wave exactly as backlog:next separates an idle offer', () => {
		const offered = epic_report.candidates_for_repo(
			backlog_rank.gate(input, { kind: 'idle' }, REPO, scope).result,
			REPO,
		)

		expect(backlog_waves.build(input, REPO, scope).waves[0]).toStrictEqual(offered)
	})

	it('puts the second claim on a path in the wave after the first', () => {
		const { waves } = backlog_waves.build(input, REPO, scope)

		expect(waves.map((wave) => wave.map((entry) => entry.number))).toStrictEqual([
			[FIRST, THIRD],
			[SECOND],
		])
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
		expect(text).toContain(
			`Wave 1  ${backlog_fixture.cite(SOLO_FIRST)} ${backlog_plan.SOLO_MARK}\n`,
		)
		expect(text).toContain(
			`Wave 2  ${backlog_fixture.cite(FIRST)} ${backlog_fixture.cite(SECOND)}   ${backlog_waves.PARALLEL_NOTE}`,
		)
	})

	it('names what each unreached issue waits on', () => {
		const parked = child(PARKED, { labels: [NEEDS_DECISION_LABEL, RUN_LANE_LABEL] })
		const input = result([child(FIRST)], [], [parked, child(SECOND, { blocked_by: [PARKED] })])
		const text = backlog_waves.format_waves(input, CONTEXT)

		expect(text).toContain(backlog_waves.UNREACHED_HEADING)
		expect(text).toContain(
			`${backlog_fixture.cite(PARKED)}  — ${backlog_waves.NEEDS_DECISION_NOTE}`,
		)
		expect(text).toContain(
			`${backlog_fixture.cite(SECOND)}  — waiting on ${backlog_fixture.cite(PARKED)}`,
		)
	})

	it('prints the unusable-graph report instead of waves for an error verdict', () => {
		const input: EpicNextResult = { ...result([]), verdict: 'error' }

		expect(backlog_waves.format_waves(input, CONTEXT)).toContain(backlog_plan.UNUSABLE_HEADING)
	})
})
