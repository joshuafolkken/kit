import { git_gh_command } from '#scripts/git/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditFinding } from './epic-audit'
import { epic_audit_cli } from './epic-audit-cli'
import { epic_audit_report } from './epic-audit-report'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import type { IssueReference } from './epic-graph'

// What `epic:audit` does when it cannot read something — a child, or the repository it is standing
// in. Both used to be reported in a way that read as an answer: a child in another repository came
// out as a bare `#7`, and a repository name that could not be read turned check 3 off in silence
// (joshuafolkken/kit#1016).

const REPO = 'joshuafolkken/kit'
const THIRD_PARTY_REPO = 'sveltejs/kit'
const EPIC = '858'
const GET_REPO = 'repo_get_name_with_owner'
const GET_BODY = 'issue_get_body'
const FAILURE_EXIT_CODE = 1

function unread(number: number, repo: string = REPO): IssueReference {
	return { repo, number }
}

function snapshot(overrides: Partial<EpicSnapshot> = {}): EpicSnapshot {
	return {
		body: undefined,
		repo: REPO,
		current_repo: REPO,
		children: [],
		child_numbers: [1],
		unreadable: [],
		skipped: [],
		has_external_children: false,
		...overrides,
	}
}

// The pair the audit reports together: the reads that failed and the rows past the fetch limit.
function findings_for(input: EpicSnapshot): ReadonlyArray<AuditFinding> {
	return epic_audit_report.unreadable_findings(
		epic_fetch.missing_children(input),
		input.current_repo,
	)
}

beforeEach(() => {
	vi.restoreAllMocks()
})

// `epic:next` refuses to run on an epic with a child it could not read; an audit reporting a clean
// bill on the same input would contradict the command that acts on it.
describe('epic_audit_report.unreadable_findings', () => {
	it('reports a child that could not be read as an error', () => {
		const findings = findings_for(snapshot({ unreadable: [unread(7)] }))

		expect(findings[0]?.level).toBe('error')
		expect(findings[0]?.message).toContain('Could not read #7;')
	})

	// A row the owner restriction refused came out as `Could not read #7`, which a reader resolves
	// against this repository — the one message joshuafolkken/kit#1014 left unqualified.
	it('names a child in another repository with that repository', () => {
		const missing = [unread(7, THIRD_PARTY_REPO)]
		const findings = findings_for(snapshot({ unreadable: missing }))

		expect(findings[0]?.message).toContain(`Could not read ${THIRD_PARTY_REPO}#7;`)
	})

	it('reports children dropped past the fetch limit too', () => {
		const findings = findings_for(snapshot({ skipped: [unread(8)] }))

		expect(findings).toHaveLength(1)
	})

	it('reports nothing when every child was read', () => {
		expect(findings_for(snapshot())).toEqual([])
	})
})

// A repository name that could not be read used to become `unknown/unknown`, and check 3's owner
// filter then dropped every qualified reference the children cited — with no diagnostic. The report
// came out clean in exactly the state that makes it meaningless, so the command stops instead.
describe('epic_audit_cli.run — the repository name it needs to resolve references against', () => {
	it('fails rather than auditing with a repository it could not name', async () => {
		vi.spyOn(git_gh_command, GET_REPO).mockResolvedValue(undefined)
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await epic_audit_cli.run([EPIC])).toBe(FAILURE_EXIT_CODE)
		expect(errors).toHaveBeenCalledWith(epic_audit_cli.UNREADABLE_REPO)
	})

	// The point is that it stops *before* reading anything: an audit that reads the epic and then
	// silently skips a check is the failure this replaces.
	it('reads nothing at all once the repository could not be named', async () => {
		vi.spyOn(git_gh_command, GET_REPO).mockResolvedValue(undefined)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const get_body = vi.spyOn(git_gh_command, GET_BODY)

		await epic_audit_cli.run([EPIC])

		expect(get_body).not.toHaveBeenCalled()
	})

	// The case joshuafolkken/kit#1012 noted still works: a name that reads goes on to the fetch.
	it('goes on to read the epic when the repository names itself', async () => {
		vi.spyOn(git_gh_command, GET_REPO).mockResolvedValue(REPO)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const get_body = vi.spyOn(git_gh_command, GET_BODY).mockResolvedValue(undefined)

		await epic_audit_cli.run([EPIC])

		expect(get_body).toHaveBeenCalledWith(EPIC, undefined)
	})
})
