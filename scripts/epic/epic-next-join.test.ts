import { describe, expect, it } from 'vitest'
import { epic_body } from './epic-body'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild } from './epic-graph'
import { epic_next } from './epic-next'

// A `josh epic --chain` join: #3 waits on #1 and #2, which are independent of each other. The body and
// the relations come from the same chains, so the selection reads them without a mismatch — and it
// reads only each child's `blocked-by`, so an independent child runs beside a running one.

const REPO = 'joshuafolkken/kit'
const JOIN_BODY = epic_body.build_epic_body({
	children: [1, 2, 3],
	rationale: 'join',
	is_ordered: false,
	chains: [
		[1, 3],
		[2, 3],
	],
})

type Phase = 'open' | 'running' | 'closed'

function child(number: number, phase: Phase, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: phase === 'closed' ? 'CLOSED' : 'OPEN',
		labels: phase === 'running' ? ['in-progress'] : [],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

function snapshot(children: ReadonlyArray<EpicChild>): EpicSnapshot {
	return {
		body: JOIN_BODY,
		repo: REPO,
		current_repo: REPO,
		children,
		child_numbers: children.map((entry) => entry.number),
		unreadable: [],
		skipped: [],
		has_external_children: false,
		body_failure: undefined,
		is_unreachable: false,
	}
}

// The join's three children, #3 waiting on both of the others.
function offered(first: Phase, second: Phase): Array<number> {
	const children = [child(1, first), child(2, second), child(3, 'open', [1, 2])]
	const result = epic_next.decide(snapshot(children))

	expect(result.anomalies).toStrictEqual([])

	return result.candidates[0]?.children.map((entry) => entry.number) ?? []
}

describe('epic_next.decide — a declared join', () => {
	it('offers the independent child while the other one runs', () => {
		expect(offered('running', 'open')).toStrictEqual([2])
	})

	it('holds the joined child while either prerequisite is open', () => {
		expect(offered('closed', 'running')).toStrictEqual([])
	})

	it('offers the joined child once both prerequisites close', () => {
		expect(offered('closed', 'closed')).toStrictEqual([3])
	})
})
