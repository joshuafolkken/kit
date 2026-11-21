import { describe, expect, it } from 'vitest'
import type { AuditChild } from './epic-audit-checks'
import { epic_audit_rationale, type OrderPair } from './epic-audit-rationale'
import { epic_body } from './epic-body'
import { epic_decision } from './epic-decision'
import { epic_parse, type DependencyLink } from './epic-parse'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const FIRST_KEY = `${REPO}#101`
const SECOND_KEY = `${REPO}#102`

function child(number: number, repo = REPO): AuditChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [], body: undefined }
}

function closed(target: AuditChild): AuditChild {
	return { ...target, state: 'CLOSED' }
}

function link(blocker: number, blocked: number): DependencyLink {
	return { blocker, blocked }
}

function pairs_of(
	links: ReadonlyArray<DependencyLink>,
	children: ReadonlyArray<AuditChild>,
): Array<OrderPair> {
	return epic_audit_rationale.order_pairs(links, children, REPO, REPO)
}

// What `read_order_comments` produces when every listing was read and held nothing: a key per pair
// end, with an empty array. An **absent** key means the listing could not be read, which is a
// different fact, so the default here must not be an empty map.
function read_nothing(pairs: ReadonlyArray<OrderPair>): Map<string, ReadonlyArray<string>> {
	const ends = epic_audit_rationale.pair_ends(pairs)

	return new Map(ends.map((end) => [`${end.repo}#${String(end.number)}`, []]))
}

function findings_of(input: {
	pairs: ReadonlyArray<OrderPair>
	decisions?: string
	comments?: ReadonlyMap<string, ReadonlyArray<string>>
}): ReadonlyArray<string> {
	return epic_audit_rationale
		.find_unjustified_orders({
			pairs: input.pairs,
			decisions: input.decisions ?? '',
			comments: input.comments ?? read_nothing(input.pairs),
			current_repo: REPO,
		})
		.map((finding) => `${finding.level}: ${finding.message}`)
}

// A child the native blocked-by relations hold behind `blockers`, in this repository.
function blocked_by(number: number, ...blockers: ReadonlyArray<number>): AuditChild {
	return {
		...child(number),
		blocked_by: blockers.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

// The declared order `#101 -> #102` between two open, local children — the shape every case below
// varies one property of.
function default_pairs(): Array<OrderPair> {
	return pairs_of([link(101, 102)], [child(101), child(102)])
}

describe('order_pairs', () => {
	it('resolves a declared order to the two children it names', () => {
		expect(default_pairs()).toHaveLength(1)
	})

	it('skips a pair whose blocker is closed, since it can no longer stall anything', () => {
		const pairs = pairs_of([link(101, 102)], [closed(child(101)), child(102)])

		expect(pairs).toStrictEqual([])
	})

	it('skips a pair whose blocked end is closed', () => {
		const pairs = pairs_of([link(101, 102)], [child(101), closed(child(102))])

		expect(pairs).toStrictEqual([])
	})

	it('skips a pair whose end lives in another repository, whose comments cannot be read', () => {
		const children = [child(101), child(102, OTHER_REPO)]
		const pairs = epic_audit_rationale.order_pairs([link(101, 102)], children, REPO, REPO)

		expect(pairs).toStrictEqual([])
	})

	it('skips a link naming an issue the epic does not track', () => {
		expect(pairs_of([link(101, 999)], [child(101), child(102)])).toStrictEqual([])
	})
})

describe('find_unjustified_orders', () => {
	it('reports a declared order with no record anywhere, as an error', () => {
		const [finding] = findings_of({ pairs: default_pairs() })

		expect(finding).toContain('error:')
		expect(finding).toContain('#101 -> #102')
		expect(finding).toContain('josh epic --remove <E> 101 102')
	})

	// The chain of 2026-09-10 that serialized five independent children and passed the audit clean.
	it('reports every link of a hand-typed chain', () => {
		const children = [child(1690), child(1694), child(1703)]
		const pairs = pairs_of([link(1690, 1694), link(1694, 1703)], children)

		expect(findings_of({ pairs })).toHaveLength(2)
	})

	it('is silent when the epic Decisions section names both ends', () => {
		const decisions = '## Decisions\n\n#102 waits on #101 because it reads its output.'

		expect(findings_of({ pairs: default_pairs(), decisions })).toStrictEqual([])
	})

	it('is silent when a comment on one end names the other', () => {
		const comments = new Map([
			[FIRST_KEY, []],
			[SECOND_KEY, ['Placed after #101 because it reads its output.']],
		])

		expect(findings_of({ pairs: default_pairs(), comments })).toStrictEqual([])
	})

	it('is not satisfied by comments that each name only the issue they sit on', () => {
		const comments = new Map([
			[FIRST_KEY, ['A note about #101 alone.']],
			[SECOND_KEY, ['A note about #102 alone.']],
		])

		expect(findings_of({ pairs: default_pairs(), comments })).toHaveLength(1)
	})

	it('reports nothing when no order is declared at all', () => {
		const pairs = pairs_of([], [child(101), child(102)])

		expect(findings_of({ pairs })).toStrictEqual([])
	})
})

describe('find_unjustified_orders — what it will not judge', () => {
	// A rate limit must not manufacture an error over an order whose reason was written down.
	it('says nothing about a pair whose comment listing could not be read', () => {
		const comments = new Map([[FIRST_KEY, []]])

		expect(findings_of({ pairs: default_pairs(), comments })).toStrictEqual([])
	})
})

// #8479 on 2026-11-21: `#8513 -> #8514` lived only in the native blocked-by, with no reason recorded,
// and the audit reported 0 errors because it read the body's `## Dependencies` alone.
function native_pairs(): Array<OrderPair> {
	return pairs_of([], [child(8513), blocked_by(8514, 8513)])
}

describe('find_unjustified_orders — a native blocked-by the body does not declare', () => {
	it('reports it as an error, naming the triage command that removes it', () => {
		const [finding] = findings_of({ pairs: native_pairs() })

		// "order", not "declared order": the body never declared this one.
		expect(finding).toContain('error: The order #8513 -> #8514 has no recorded reason')
		expect(finding).toContain('josh backlog:triage --apply 8514 --unblock 8513')
		expect(finding).toContain('path-overlap check')
	})

	it('is silent when the epic Decisions section records its reason', () => {
		const decisions = '## Decisions\n\n#8514 waits on #8513 because it reads its output.'

		expect(findings_of({ pairs: native_pairs(), decisions })).toStrictEqual([])
	})

	it('is silent when a comment on the blocked end records its reason', () => {
		const comments = new Map([
			[`${REPO}#8513`, []],
			[`${REPO}#8514`, ['Placed after #8513 because it reads its output.']],
		])

		expect(findings_of({ pairs: native_pairs(), comments })).toStrictEqual([])
	})

	// An unread child is absent from `children` (`epic_fetch` reports it as unreadable instead).
	it('says nothing about a relation whose blocker could not be read', () => {
		const pairs = pairs_of([], [blocked_by(8514, 8513)])

		expect(findings_of({ pairs })).toStrictEqual([])
	})

	it('reports an order both declared and native once', () => {
		const pairs = pairs_of([link(101, 102)], [child(101), blocked_by(102, 101)])

		expect(findings_of({ pairs })).toHaveLength(1)
	})
})

// A documented epic must pass its own audit. Using the real builder and section reader proves
// their agreement without relying on a hand-written fixture.
describe('find_unjustified_orders — an epic created with `--ordered`', () => {
	it('reports nothing, because the creation records the order it declared', () => {
		const body = epic_body.build_epic_body({
			children: [101, 102],
			rationale: '',
			is_ordered: true,
		})
		const links = epic_parse.parse_dependency_links(body)
		const pairs = pairs_of(links, [child(101), child(102)])

		expect(
			findings_of({ pairs, decisions: epic_decision.read_recorded_reasons(body) }),
		).toStrictEqual([])
	})

	it('reports nothing when the order carries its own reason instead of the pointer', () => {
		const reason = '#102 reads the table #101 writes'
		const body = epic_body.build_epic_body({
			children: [101, 102],
			rationale: '',
			is_ordered: true,
			order_reasons: [{ chain: [101, 102], reason }],
		})
		const pairs = pairs_of(epic_parse.parse_dependency_links(body), [child(101), child(102)])
		const decisions = epic_decision.read_recorded_reasons(body)

		expect(decisions).toContain(reason)
		expect(findings_of({ pairs, decisions })).toStrictEqual([])
	})
})
