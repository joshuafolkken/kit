import type { DependencyLink } from '#scripts/git/git-epic-parse'
import { describe, expect, it } from 'vitest'
import type { AuditChild } from './epic-audit-checks'
import { epic_audit_rationale, type OrderPair } from './epic-audit-rationale'

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
