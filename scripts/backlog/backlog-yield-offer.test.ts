import type { BusyRead } from '#scripts/epic/epic-busy'
import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap, type Declared } from './backlog-overlap'
import { backlog_rank } from './backlog-rank'

// joshuafolkken/kit#5107: a yielded child must be offered again when its holder merges, ahead of
// unrelated pool work.

const { REPO } = backlog_fixture
const HOLDER = 5084
const YIELDED = 5083
const LATER = 5091
const OTHER = 5086
const PROPERTIES = 'sonar-project.properties'
const SONAR_TEST = 'scripts/security/sonar-config.test.ts'
// The holder's `lane:plan` record.
const HOLDER_PLAN = new Set([PROPERTIES, SONAR_TEST])
// joshuafolkken/kit#5083's body, abridged: the root file in a code span beside Sonar property names.
const YIELDED_BODY = [
	'#5072 は `sonar-project.properties` にテストファイルを `sonar.tests` / `sonar.test.inclusions` で宣言し',
	'- [ ] `sonar-project.properties` に #5072 の宣言が戻る',
].join('\n')
const LATER_BODY = '- `scripts/run/merge/run-merge.ts` を直す'
const OTHER_BODY = '- `scripts/lane/lane-stats.ts` を直す'
const IDLE: BusyRead = { kind: 'idle' }

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function holder_running(): BusyRead {
	return {
		kind: 'busy',
		issues: [
			{ number: HOLDER, title: 'holder', createdAt: '2026-10-27T02:49:51Z', blockedBy: undefined },
		],
	}
}

function body_declared(): Declared {
	return backlog_overlap.declared_of([
		{ number: LATER, body: LATER_BODY },
		{ number: OTHER, body: OTHER_BODY },
		{ number: YIELDED, body: YIELDED_BODY },
	])
}

interface Offer {
	read: BusyRead
	declared: Declared
	yielded?: ReadonlySet<string>
}

// The pool in the order it ranks: the later issues first, the yielded one last.
function offered(offer: Offer): Array<number> {
	const candidates = [child(LATER), child(OTHER), child(YIELDED)]
	const selection = backlog_rank.select({
		candidates,
		pool: candidates,
		repo: REPO,
		standalone: new Set(),
		...offer,
	})

	return selection.offered.map((entry) => entry.number)
}

function yielded_set(): ReadonlySet<string> {
	return new Set([epic_graph.key_of(child(YIELDED))])
}

describe('backlog_overlap.declared_paths — a root .properties file', () => {
	it('reads `sonar-project.properties` but not the dotted Sonar property names beside it', () => {
		expect(backlog_overlap.declared_paths(YIELDED_BODY)).toStrictEqual(new Set([PROPERTIES]))
	})
})

describe('backlog_rank.select — the joshuafolkken/kit#5083 dispatch at 02:56', () => {
	it("holds the candidate back on the holder's recorded plan before it is dispatched", () => {
		const declared = new Map([...body_declared(), [HOLDER, HOLDER_PLAN]])

		expect(offered({ read: holder_running(), declared })).toStrictEqual([LATER, OTHER])
	})
})

describe('backlog_rank.select — the offer after a yield', () => {
	it('offers the yielded issue first once its holder has merged (03:00)', () => {
		const declared = new Map([...body_declared(), [YIELDED, HOLDER_PLAN]])

		expect(offered({ read: IDLE, declared, yielded: yielded_set() })).toStrictEqual([
			YIELDED,
			LATER,
			OTHER,
		])
	})

	it('keeps it held back, and the others offered, while the holder still runs (02:57)', () => {
		const declared = new Map([...body_declared(), [YIELDED, HOLDER_PLAN], [HOLDER, HOLDER_PLAN]])

		expect(offered({ read: holder_running(), declared, yielded: yielded_set() })).toStrictEqual([
			LATER,
			OTHER,
		])
	})

	it('leaves the order of candidates that do not overlap untouched when none yielded', () => {
		const declared = backlog_overlap.declared_of([
			{ number: LATER, body: LATER_BODY },
			{ number: OTHER, body: OTHER_BODY },
		])

		expect(offered({ read: IDLE, declared, yielded: new Set() })).toStrictEqual([
			LATER,
			OTHER,
			YIELDED,
		])
	})
})
