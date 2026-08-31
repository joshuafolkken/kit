import { describe, expect, it } from 'vitest'
import { epic_audit_logic } from './epic-audit'
import { epic_audit_checks, type AuditChild } from './epic-audit-checks'
import { epic_graph } from './epic-graph'

const REPO = 'joshuafolkken/kit'
const ACCEPTANCE_BODY = '## 受け入れ条件\n\n- [ ] uses the map from #869'

function child(number: number, body: string, blocked_by: ReadonlyArray<number> = []): AuditChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker })),
		body,
	}
}

function closed(child_to_close: AuditChild): AuditChild {
	return { ...child_to_close, state: 'CLOSED' }
}

function messages(findings: ReadonlyArray<{ message: string }>): string {
	return findings.map((finding) => finding.message).join('\n')
}

describe('epic_audit_logic.parse_references', () => {
	it('reads the issue numbers out of prose', () => {
		expect(epic_audit_logic.parse_references('needs #863 and #864')).toEqual([863, 864])
	})

	it('reports each number once', () => {
		expect(epic_audit_logic.parse_references('#863 then #863 again')).toEqual([863])
	})

	it('finds nothing in prose with no references', () => {
		expect(epic_audit_logic.parse_references('no references here')).toEqual([])
	})

	// Another repository's issue 12 is not this one's. Reading its tail produced warnings about
	// issues that were fine.
	it('does not read the tail of another repository reference', () => {
		expect(epic_audit_logic.parse_references('see joshuafolkken/app-kit#12', REPO)).toEqual([])
	})

	// The bodies write local references the same way, so stripping only the current repository's
	// prefix is what keeps the check from ignoring nearly everything it exists to read.
	it('reads a reference qualified with this repository as local', () => {
		expect(epic_audit_logic.parse_references('see joshuafolkken/kit#863', REPO)).toEqual([863])
	})

	it('reads both forms in one body', () => {
		const text = 'joshuafolkken/kit#863 and #864, plus joshuafolkken/app-kit#12'

		expect(epic_audit_logic.parse_references(text, REPO)).toEqual([863, 864])
	})
})

describe('epic_audit_logic.acceptance_section', () => {
	it('reads the Japanese heading the templates use', () => {
		const body = '## 背景\n\ncontext #1\n\n## 受け入れ条件\n\n- [ ] needs #2\n'

		expect(epic_audit_logic.acceptance_section(body)).toContain('#2')
		expect(epic_audit_logic.acceptance_section(body)).not.toContain('#1')
	})

	it('reads the English heading too', () => {
		const body = '## Acceptance criteria\n\n- [ ] needs #2'

		expect(epic_audit_logic.acceptance_section(body)).toContain('#2')
	})

	it('stops at the next heading', () => {
		const body = '## 受け入れ条件\n\n- [ ] needs #2\n\n## Notes\n\nabout #3'

		expect(epic_audit_logic.acceptance_section(body)).not.toContain('#3')
	})

	it('returns nothing when the section is absent', () => {
		expect(epic_audit_logic.acceptance_section('## 背景\n\ntext')).toBe('')
	})

	it('returns nothing for a missing body', () => {
		expect(epic_audit_logic.acceptance_section(undefined)).toBe('')
	})
})

describe('epic_audit_logic.depends_on', () => {
	const one = child(1, '')
	const two = child(2, '', [1])
	const three = child(3, '', [2])
	const index = epic_graph.index_children([one, two, three])

	it('finds a direct dependency', () => {
		expect(epic_audit_logic.depends_on(index, two, one)).toBe(true)
	})

	it('finds one through a chain', () => {
		expect(epic_audit_logic.depends_on(index, three, one)).toBe(true)
	})

	it('does not invent one in the other direction', () => {
		expect(epic_audit_logic.depends_on(index, one, three)).toBe(false)
	})

	// An epic can track two children whose numbers collide across repositories.
	it('does not confuse two children that share a number in different repositories', () => {
		const remote: AuditChild = { ...child(1, ''), repo: 'joshuafolkken/app-kit' }
		const mixed = epic_graph.index_children([one, two, remote])

		expect(epic_audit_logic.depends_on(mixed, two, remote)).toBe(false)
		expect(epic_audit_logic.depends_on(mixed, two, one)).toBe(true)
	})

	// The auditor must not hang on the input it exists to examine.
	it('terminates on a cyclic graph', () => {
		const first = child(1, '', [2])
		const second = child(2, '', [1])
		const cyclic = epic_graph.index_children([first, second])

		expect(epic_audit_logic.depends_on(cyclic, first, child(99, ''))).toBe(false)
	})
})

// The shape found by hand in joshuafolkken/kit#858: two children each citing the other's
// deliverable, `blocked_by` empty on both, and the epic declaring them independent.
describe('epic_audit_checks.find_implicit_dependencies', () => {
	it('warns about the mutual-reference shape that was found by hand', () => {
		const findings = epic_audit_checks.find_implicit_dependencies(
			[
				child(863, 'uses the discovery result of #864'),
				child(864, 'shares the publish check with #863'),
			],
			REPO,
		)

		expect(findings).toHaveLength(2)
		expect(findings.every((finding) => finding.level === 'warning')).toBe(true)
	})

	it('says nothing when the dependency is declared', () => {
		const findings = epic_audit_checks.find_implicit_dependencies(
			[child(863, 'delivers what #864 needs'), child(864, 'uses #863', [863])],
			REPO,
		)

		expect(findings).toEqual([])
	})

	// "This part is filled in by #864" is a legitimate design note, and an undeclared one is exactly
	// what the warning is for — but it must never become an error.
	it('keeps a forward reference at warning level', () => {
		const findings = epic_audit_checks.find_implicit_dependencies(
			[child(1, 'this part is filled in by #2'), child(2, '')],
			REPO,
		)

		expect(findings).toHaveLength(1)
		expect(findings[0]?.level).toBe('warning')
	})

	it('ignores a reference to an issue outside the epic', () => {
		expect(epic_audit_checks.find_implicit_dependencies([child(1, 'see #999')], REPO)).toEqual([])
	})

	it('ignores a child citing its own number', () => {
		expect(epic_audit_checks.find_implicit_dependencies([child(1, 'this is #1')], REPO)).toEqual([])
	})
})

// The other contradiction found by hand: #860's acceptance criteria required deliverables of #863
// and #864, while the graph let #860 run first.
describe('epic_audit_checks.find_order_contradictions', () => {
	it('fails a child whose acceptance criteria need something built later', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(860, ACCEPTANCE_BODY), child(869, '')],
			REPO,
		)

		expect(findings).toHaveLength(1)
		expect(findings[0]?.level).toBe('error')
		expect(messages(findings)).toContain('#869')
	})

	// `#860`'s criteria say `#864` will extend a hook it provides, and `#864` depends on `#860`. The
	// criteria are satisfiable exactly as written; calling that an error made four of five errors on
	// the real epic false positives.
	it('accepts a forward reference the other child already depends on', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(860, '## 受け入れ条件\n\n- [ ] a hook #864 can extend'), child(864, '', [860])],
			REPO,
		)

		expect(findings).toEqual([])
	})

	it('accepts the same criteria once the dependency is declared', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(860, ACCEPTANCE_BODY, [869]), child(869, '')],
			REPO,
		)

		expect(findings).toEqual([])
	})
})

// Both children closed means neither has any execution left, so the sentence that makes an
// undeclared order a contradiction — "it can run first" — is no longer true of either. An epic that
// forgot to declare an order would otherwise fail its audit forever, stopping every future `epicrun`
// on it at the first step (joshuafolkken/kit#1010).
describe('epic_audit_checks.find_order_contradictions — a pair with nothing left to run', () => {
	it('demotes the finding to a warning when both children are closed', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[closed(child(860, ACCEPTANCE_BODY)), closed(child(869, ''))],
			REPO,
		)

		expect(findings).toHaveLength(1)
		expect(findings[0]?.level).toBe('warning')
		expect(messages(findings)).toContain('both are closed')
	})

	// Demoted, not dropped: the pair keeps a finding, so check 1 still suppresses it as already
	// reported rather than counting the same omission a second time.
	it('keeps naming both children, so the pair is still reported once', () => {
		const children = [closed(child(860, ACCEPTANCE_BODY)), closed(child(869, ''))]
		const contradictions = epic_audit_checks.find_order_contradictions(children, REPO)

		expect(messages(contradictions)).toContain('#860')
		expect(messages(contradictions)).toContain('#869')
		expect(epic_audit_checks.find_implicit_dependencies(children, REPO, contradictions)).toEqual([])
	})

	it('keeps the error while the child naming the other is still open', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(860, ACCEPTANCE_BODY), closed(child(869, ''))],
			REPO,
		)

		expect(findings[0]?.level).toBe('error')
	})

	it('keeps the error while the child that is named is still open', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[closed(child(860, ACCEPTANCE_BODY)), child(869, '')],
			REPO,
		)

		expect(findings[0]?.level).toBe('error')
	})
})

describe('epic_audit_checks.find_order_contradictions — what it accepts', () => {
	it('accepts a transitive dependency', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(1, '## 受け入れ条件\n\n- [ ] needs #3', [2]), child(2, '', [3]), child(3, '')],
			REPO,
		)

		expect(findings).toEqual([])
	})

	// A reference in the background section is a design note; only the criteria state what must be
	// deliverable, so only they can contradict the order.
	it('ignores a reference outside the acceptance criteria', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(1, '## 背景\n\nrelated to #2'), child(2, '')],
			REPO,
		)

		expect(findings).toEqual([])
	})
})

describe('epic_audit_checks.find_orphans', () => {
	// An issue naming the epic as its parent but absent from the task list would never be run, and
	// the epic would close without it.
	it('warns about an issue the task list does not track', () => {
		const findings = epic_audit_checks.find_orphans([101, 102], [101, 103])

		expect(findings).toHaveLength(1)
		expect(messages(findings)).toContain('#103')
	})

	it('says nothing when every claiming issue is tracked', () => {
		expect(epic_audit_checks.find_orphans([101, 102], [101, 102])).toEqual([])
	})

	it('says nothing when nothing claims the epic', () => {
		expect(epic_audit_checks.find_orphans([101], [])).toEqual([])
	})
})
