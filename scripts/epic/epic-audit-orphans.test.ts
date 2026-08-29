import { describe, expect, it } from 'vitest'
import { epic_audit_orphans } from './epic-audit-orphans'
import type { EpicSnapshot } from './epic-fetch'

// Check 4: an issue naming this epic as its parent that the epic's task list does not track.

const REPO = 'joshuafolkken/kit'
const DOTTED_REPO = 'joshuafolkken/site.com'
const EPIC = 858

function snapshot(body: string | undefined): EpicSnapshot {
	return {
		body,
		current_repo: REPO,
		children: [],
		child_numbers: [1],
		unreadable: [],
		skipped: [],
		has_external_children: false,
	}
}

function claims(body: string | null): boolean {
	return epic_audit_orphans.claims_parent(body, EPIC, REPO)
}

describe('epic_audit_orphans.claims_parent', () => {
	it('recognizes the parent line the templates write', () => {
		expect(claims('親: joshuafolkken/kit#858')).toBe(true)
	})

	it('recognizes the English spelling', () => {
		expect(claims('Parent: #858')).toBe(true)
	})

	// An issue parented to a different epic routinely backlinks this one elsewhere in its body;
	// matching the marker and the number independently reported every such issue as an orphan.
	it('does not claim an issue whose parent line names a different epic', () => {
		const body = '親: joshuafolkken/kit#900\n\nRelated to #858 for context.'

		expect(claims(body)).toBe(false)
	})

	it('does not claim an issue that merely mentions the epic', () => {
		expect(claims('see #858')).toBe(false)
	})

	// The parse now admits a dot in a repository name, and settles it against the repositories in
	// view; this call site's set is this repository alone, so a repository whose own name contains a
	// dot still recognizes its parent line (joshuafolkken/kit#1016).
	it('recognizes a parent line in a repository whose name contains a dot', () => {
		const line = `親: ${DOTTED_REPO}#858`

		expect(epic_audit_orphans.claims_parent(line, EPIC, DOTTED_REPO)).toBe(true)
	})

	// A parent line naming another repository's epic of the same number is not this epic's child
	// (joshuafolkken/kit#1014).
	it('does not claim an issue parented to the same number elsewhere', () => {
		expect(claims('親: joshuafolkken/app-kit#858')).toBe(false)
	})

	// `gh issue list --json body` answers with JSON null for an issue that has none.
	it('handles a body gh reported as null', () => {
		// eslint-disable-next-line unicorn/no-null -- the shape gh's JSON actually produces
		expect(claims(null)).toBe(false)
	})
})

// An orphan is recognized by number alone, so the numbers it is checked against must be this
// repository's rows only (joshuafolkken/kit#1014).
describe('epic_audit_orphans.locally_tracked', () => {
	it('reads the rows naming this repository', () => {
		expect(epic_audit_orphans.locally_tracked(snapshot('- [ ] #12\n- [ ] #13'))).toEqual([12, 13])
	})

	it('leaves out a row naming another repository', () => {
		const body = '- [ ] #12\n- [ ] joshuafolkken/app-kit#40'

		expect(epic_audit_orphans.locally_tracked(snapshot(body))).toEqual([12])
	})
})
