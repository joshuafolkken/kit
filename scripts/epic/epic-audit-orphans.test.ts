import { git_gh_command } from '#scripts/git/git-gh-command'
import { MAX_SCANNED } from '#scripts/git/git-gh-issue-list'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_audit_orphans, type ClaimingSearch } from './epic-audit-orphans'
import type { EpicSnapshot } from './epic-fetch'

// Check 4: an issue naming this epic as its parent that the epic's task list does not track.

const REPO = 'joshuafolkken/kit'
const DOTTED_REPO = 'joshuafolkken/site.com'
const EPIC = 858
const CLAIMING_NUMBER = 5
// The epic itself carries the number in its own body, and is never its own orphan.
const EPIC_ROW = { number: EPIC, body: `親: #${String(EPIC)}` }
// The cap the search itself asks for, matching `epic-audit-orphans.ts`'s own `SEARCH_LIMIT`.
const SEARCH_LIMIT = 50

// A row that mentions the epic without claiming it as its parent — what fills the match cap on a
// long-running epic, and what `claims_parent` then discards.
function mention_row(_value: unknown, index: number): { number: number; body: string } {
	return { number: EPIC + index + 1, body: `see #${String(EPIC)}` }
}

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

function serve_search(json: string | undefined, is_capped = false): void {
	vi.spyOn(git_gh_command, 'issue_search_body').mockResolvedValue({ json, is_capped })
}

function levels(search: ClaimingSearch): Array<string> {
	return epic_audit_orphans.search_findings(search).map((finding) => finding.level)
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

	// REST answers JSON null for an issue with no body, and `git-gh-issue-rest.ts` maps that to an
	// empty string before a search row reaches here — so the null is what `searched_issue_schema` and
	// `claims_parent` still admit rather than a shape the listing delivers, and this pins that the
	// tolerance holds.
	it('handles a body reported as null', () => {
		// eslint-disable-next-line unicorn/no-null -- the shape the schema still admits
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

// joshuafolkken/kit#1033: a rate limit used to arrive here as `[]`, which is what "no issue claims
// this epic" looks like — so `epic:audit` reported zero orphans without having read anything.
describe('epic_audit_orphans.find_claiming_issues', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('reports a listing it could not read as unreadable rather than as no orphans', async () => {
		serve_search(undefined)

		expect(await epic_audit_orphans.find_claiming_issues(EPIC, REPO)).toEqual({
			kind: 'unreadable',
		})
	})

	it('keeps the issues whose parent line names this epic', async () => {
		serve_search(
			JSON.stringify([{ number: CLAIMING_NUMBER, body: `親: #${String(EPIC)}` }, EPIC_ROW]),
		)

		expect(await epic_audit_orphans.find_claiming_issues(EPIC, REPO)).toEqual({
			kind: 'read',
			numbers: [CLAIMING_NUMBER],
			cutoff: 'none',
		})
	})

	// The flag has to survive to the caller — it is the only thing that tells a scan cut short by the
	// page ceiling from one that looked at the whole backlog and found nothing.
	it('carries a scan the page ceiling cut short out to the caller', async () => {
		serve_search('[]', true)

		expect(await epic_audit_orphans.find_claiming_issues(EPIC, REPO)).toEqual({
			kind: 'read',
			numbers: [],
			cutoff: 'page_ceiling',
		})
	})
})

// The cutoff this caller alone can see: the rows are mapped through `claims_parent` before anything
// counts them, so the row count every other listing reads its own `limit` cap off is gone by the
// time the answer leaves here.
describe('epic_audit_orphans.find_claiming_issues — the match cap', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('reports a scan that filled its match cap, even with no orphan among the matches', async () => {
		serve_search(JSON.stringify(Array.from({ length: SEARCH_LIMIT }, mention_row)))

		expect(await epic_audit_orphans.find_claiming_issues(EPIC, REPO)).toEqual({
			kind: 'read',
			numbers: [],
			cutoff: 'row_limit',
		})
	})
})

describe('epic_audit_orphans.search_findings', () => {
	// Check 4 did not run at all, and `epic:audit` already fails on a child it could not read — an
	// audit that reported a clean bill on the same kind of gap would contradict itself.
	it('reports an unreadable search as an error', () => {
		expect(levels({ kind: 'unreadable' })).toEqual(['error'])
	})

	// The scan did run, over the newest issues, and an orphan is normally one filed minutes ago — so
	// this is something to read, at the level `epic:bundle` reports its own cap at.
	it('reports a scan the page ceiling cut short as a warning naming the ceiling', () => {
		const findings = epic_audit_orphans.search_findings({
			kind: 'read',
			numbers: [],
			cutoff: 'page_ceiling',
		})

		expect(findings.map((finding) => finding.level)).toEqual(['warning'])
		expect(findings[0]?.message).toContain(String(MAX_SCANNED))
	})

	// Named apart from the page ceiling: the two hide different things, and a reader told only that
	// "the scan was cut short" cannot tell which of them to raise.
	it('reports a scan that filled its match cap as a warning naming that cap', () => {
		const findings = epic_audit_orphans.search_findings({
			kind: 'read',
			numbers: [],
			cutoff: 'row_limit',
		})

		expect(findings.map((finding) => finding.level)).toEqual(['warning'])
		expect(findings[0]?.message).toContain(String(SEARCH_LIMIT))
	})

	it('says nothing about a search that covered the backlog', () => {
		expect(levels({ kind: 'read', numbers: [], cutoff: 'none' })).toEqual([])
	})
})

describe('epic_audit_orphans.claimed_numbers', () => {
	it('answers nothing for a search that failed, which the error above has already reported', () => {
		expect(epic_audit_orphans.claimed_numbers({ kind: 'unreadable' })).toEqual([])
	})

	it('answers what the search found', () => {
		expect(
			epic_audit_orphans.claimed_numbers({
				kind: 'read',
				numbers: [CLAIMING_NUMBER],
				cutoff: 'none',
			}),
		).toEqual([CLAIMING_NUMBER])
	})
})
