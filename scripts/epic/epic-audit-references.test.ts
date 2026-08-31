import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { describe, expect, it } from 'vitest'
import { epic_audit_logic, type AuditFinding, type ReferenceState } from './epic-audit'
import { epic_audit_checks, type AuditChild } from './epic-audit-checks'
import { epic_graph } from './epic-graph'

// Reading a child's references against the repository that child lives in (joshuafolkken/kit#1014).
//
// joshuafolkken/kit#1012 made the audit read a cross-repository child's *body* from the right
// repository. The numbers inside that body are issue numbers in the same place, and resolving them
// here meant checking a different issue entirely.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const ACCEPTANCE = '## 受け入れ条件\n\n- [ ] needs #40'
const OTHER_40 = 'joshuafolkken/app-kit#40'
const OTHER_12 = 'joshuafolkken/app-kit#12'
const LOCAL_40 = 'joshuafolkken/kit#40'
const DOTTED_REPO = 'joshuafolkken/site.com'
const DOTTED_40 = `${DOTTED_REPO}#40`
const PROSE_PATH = 'see prompts/review.md#5'

function child(
	number: number,
	repo: string,
	body: string,
	blocked_by: ReadonlyArray<number> = [],
): AuditChild {
	return {
		number,
		repo,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo, number: blocker })),
		body,
	}
}

// The resolved states, keyed the way the audit keys them: repository and number both.
function states_of(
	entries: ReadonlyArray<readonly [string, number, ReferenceState]>,
): Map<string, ReferenceState> {
	return new Map(
		entries.map(([repo, number, state]) => [epic_graph.reference_key(repo, number), state]),
	)
}

function unresolved(
	children: ReadonlyArray<AuditChild>,
	states: ReadonlyMap<string, ReferenceState>,
): ReadonlyArray<AuditFinding> {
	return epic_audit_checks.find_unresolved_references(children, states, REPO)
}

function first_message(findings: ReadonlyArray<AuditFinding>): string {
	return findings[0]?.message ?? ''
}

describe('epic_audit_logic.parse_issue_references', () => {
	it('reads a bare number as the repository whose body wrote it', () => {
		expect(epic_audit_logic.parse_issue_references('see #40', OTHER_REPO)).toEqual([
			{ repo: OTHER_REPO, number: 40 },
		])
	})

	it('reads a qualified reference as the repository it names', () => {
		expect(
			epic_audit_logic.parse_issue_references('see joshuafolkken/app-kit#40 and #12', REPO),
		).toEqual([
			{ repo: OTHER_REPO, number: 40 },
			{ repo: REPO, number: 12 },
		])
	})

	// The same issue written both ways is one reference, not two.
	it('reports each issue once however it was written', () => {
		expect(epic_audit_logic.parse_issue_references('joshuafolkken/kit#40 and #40', REPO)).toEqual([
			{ repo: REPO, number: 40 },
		])
	})

	// A repository name with no owner is not a reference: `kit#12` names nothing GitHub can resolve.
	it('does not read a name that carries no owner', () => {
		expect(epic_audit_logic.parse_issue_references('see kit#12', REPO)).toEqual([])
	})

	// A path written in prose has the shape of an `owner/repo` and is not one; resolving it would
	// send the audit looking for a repository nobody named.
	it('does not read a path written in prose as a repository', () => {
		expect(epic_audit_logic.parse_issue_references(PROSE_PATH, REPO)).toEqual([])
	})

	// The tail of a URL was refused before and stays refused: the anchor is not an issue reference.
	it('does not read the tail of a URL', () => {
		const text = 'see https://github.com/joshuafolkken/kit#40'

		expect(epic_audit_logic.parse_issue_references(text, REPO)).toEqual([])
	})
})

// It lives beside the key it is the readable half of, so `epic:next` writes an unread child exactly
// as the audit writes a citation (joshuafolkken/kit#1016).
describe('epic_graph.format_reference', () => {
	it('writes an issue in this repository bare, as every message always did', () => {
		expect(epic_graph.format_reference({ repo: REPO, number: 40 }, REPO)).toBe('#40')
	})

	// A bare number resolves against the reader's own repository and names a different issue there.
	it('writes an issue in another repository with its repository', () => {
		expect(epic_graph.format_reference({ repo: OTHER_REPO, number: 40 }, REPO)).toBe(OTHER_40)
	})

	it('writes a list of them the way every message lists references', () => {
		const missing = [
			{ repo: REPO, number: 7 },
			{ repo: OTHER_REPO, number: 40 },
		]

		expect(epic_graph.format_references(missing, REPO)).toBe(`#7, ${OTHER_40}`)
	})
})

// The task list has always tracked `- [ ] owner/site.com#40` as a genuine cross-repository child,
// while this parse refused the dot — so a sibling quoting that child was skipped in silence. The two
// now accept the same children, and the path misread the exclusion existed for stays refused: no
// epic tracks a repository called `prompts/review.md` (joshuafolkken/kit#1016).
describe('epic_audit_logic.parse_issue_references — a repository name with a dot', () => {
	const known = new Set([REPO, DOTTED_REPO])

	it('reads a dotted name the epic tracks', () => {
		expect(epic_audit_logic.parse_issue_references(`see ${DOTTED_40}`, REPO, known)).toEqual([
			{ repo: DOTTED_REPO, number: 40 },
		])
	})

	it('refuses a path written in prose even with an epic in view', () => {
		expect(epic_audit_logic.parse_issue_references(PROSE_PATH, REPO, known)).toEqual([])
	})

	// The set is what settles it, not the syntax: nothing else can tell the two apart.
	it('refuses a dotted name no epic tracks', () => {
		expect(epic_audit_logic.parse_issue_references(`see ${DOTTED_40}`, REPO)).toEqual([])
	})

	// A name without a dot is unchanged, with or without a set.
	it('leaves a dotless qualified reference exactly as it was', () => {
		expect(epic_audit_logic.parse_issue_references(`see ${OTHER_40}`, REPO)).toEqual([
			{ repo: OTHER_REPO, number: 40 },
		])
	})
})

// Whatever the task list can track, a sibling's prose can cite. That is the alignment
// joshuafolkken/kit#1016 asked for, checked against the parser that reads the rows.
describe('the tracked children and the citable ones are the same set', () => {
	it('cites every repository a task-list row can name', () => {
		const rows = `- [ ] ${DOTTED_40}\n- [ ] ${OTHER_40}`
		const tracked = git_epic_parse.parse_external_task_list_children(rows)
		const known = new Set([REPO, ...tracked.map((entry) => entry.repo)])

		for (const entry of tracked) {
			const text = `see ${epic_graph.reference_key(entry.repo, entry.number)}`

			expect(epic_audit_logic.parse_issue_references(text, REPO, known)).toEqual([entry])
		}
	})
})

describe('epic_audit_checks — references between children of another repository', () => {
	// Written `owner/repo#N`, a reference used to be dropped before it was read at all, so a real
	// missing dependency between two cross-repository children went unreported.
	it('reads a qualified reference to a sibling in the same other repository', () => {
		const findings = epic_audit_checks.find_implicit_dependencies(
			[child(12, OTHER_REPO, `uses ${OTHER_40}`), child(40, OTHER_REPO, '')],
			REPO,
		)

		expect(findings).toHaveLength(1)
		expect(first_message(findings)).toContain(OTHER_12)
		expect(first_message(findings)).toContain(OTHER_40)
	})

	it('reads a bare reference in a cross-repository child as its own repository', () => {
		const findings = epic_audit_checks.find_order_contradictions(
			[child(12, OTHER_REPO, ACCEPTANCE), child(40, OTHER_REPO, '')],
			REPO,
		)

		expect(findings).toHaveLength(1)
		expect(findings[0]?.level).toBe('error')
		expect(first_message(findings)).toContain(`${OTHER_12} names ${OTHER_40}`)
	})

	// The number a cross-repository child cites is not this repository's child of that number, so
	// nothing orders the two and nothing may claim they are the same issue.
	it('does not match a citation against a same-numbered child elsewhere', () => {
		const findings = epic_audit_checks.find_implicit_dependencies(
			[child(12, OTHER_REPO, 'uses #40'), child(40, REPO, '')],
			REPO,
		)

		expect(findings).toEqual([])
	})
})

describe('epic_audit_checks — a pair in two repositories', () => {
	// The exemption predates joshuafolkken/kit#1126, when a cross-repository order could not be
	// recorded at all and the finding would have been one nobody could ever clear. It is recordable
	// now, and the exemption is kept deliberately: lifting it turns an **error** red on epics that are
	// green today, which stops every `epicrun` on them. joshuafolkken/kit#1128 decides that.
	it('raises no contradiction between children of two different repositories', () => {
		const criteria = `## 受け入れ条件\n\n- [ ] needs ${LOCAL_40}`
		const findings = epic_audit_checks.find_order_contradictions(
			[child(12, OTHER_REPO, criteria), child(40, REPO, '')],
			REPO,
		)

		expect(findings).toEqual([])
	})

	it('raises no implicit dependency across a repository boundary', () => {
		const findings = epic_audit_checks.find_implicit_dependencies(
			[child(12, OTHER_REPO, `uses ${LOCAL_40}`), child(40, REPO, '')],
			REPO,
		)

		expect(findings).toEqual([])
	})

	// The pair check 2 reported is suppressed in check 1 by repository and number both, which is what
	// the qualified wording has to survive being read back.
	it('counts a cross-repository contradiction once', () => {
		const children = [child(12, OTHER_REPO, ACCEPTANCE), child(40, OTHER_REPO, '')]
		const contradictions = epic_audit_checks.find_order_contradictions(children, REPO)

		expect(epic_audit_checks.find_implicit_dependencies(children, REPO, contradictions)).toEqual([])
	})
})

// The states are keyed by repository and number both, so a number alone can no longer answer for the
// issue of that number in whichever repository asked (joshuafolkken/kit#1014).
describe('epic_audit_checks.find_unresolved_references', () => {
	it('warns about a reference to an issue that does not exist', () => {
		const findings = unresolved(
			[child(1, REPO, 'see #999')],
			states_of([[REPO, 999, 'UNRESOLVED']]),
		)

		expect(findings[0]?.level).toBe('warning')
		expect(first_message(findings)).toContain('could not be resolved')
	})

	it('warns about a reference to a closed issue', () => {
		const findings = unresolved([child(1, REPO, 'see #900')], states_of([[REPO, 900, 'CLOSED']]))

		expect(first_message(findings)).toContain('already closed')
	})

	it('says nothing about an open one', () => {
		expect(unresolved([child(1, REPO, 'see #900')], states_of([[REPO, 900, 'OPEN']]))).toEqual([])
	})

	it('says nothing about an issue it was given no state for', () => {
		expect(unresolved([child(1, REPO, 'see #900')], new Map())).toEqual([])
	})

	it('leaves a reference in this repository written bare, exactly as before', () => {
		const findings = unresolved([child(1, REPO, 'see #900')], states_of([[REPO, 900, 'CLOSED']]))

		expect(first_message(findings)).toContain('#1 refers to #900')
		expect(first_message(findings)).not.toContain(REPO)
	})
})

describe('epic_audit_checks.find_unresolved_references — across repositories', () => {
	it('warns from the state of the repository the reference names', () => {
		const states = states_of([
			[OTHER_REPO, 40, 'CLOSED'],
			[REPO, 40, 'OPEN'],
		])
		const findings = unresolved([child(12, OTHER_REPO, 'see #40')], states)

		expect(findings).toHaveLength(1)
		expect(first_message(findings)).toContain(OTHER_40)
	})

	// The other direction of the same mix-up: this repository's issue 40 is closed and the one
	// actually referenced is open, so the number alone answers with the wrong issue's state.
	it('says nothing when the repository it names has it open', () => {
		const states = states_of([
			[OTHER_REPO, 40, 'OPEN'],
			[REPO, 40, 'CLOSED'],
		])

		expect(unresolved([child(12, OTHER_REPO, 'see #40')], states)).toEqual([])
	})
})
