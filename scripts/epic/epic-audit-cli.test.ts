import { git_gh_command } from '#scripts/git/git-gh-command'
import type { ScanCutoff } from '#scripts/git/listing-cutoff'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditFinding, ReferenceState } from './epic-audit'
import type { AuditChild } from './epic-audit-checks'
import { epic_audit_cli, type AuditInput } from './epic-audit-cli'
import type { ClaimingSearch } from './epic-audit-orphans'
import { epic_fetch } from './epic-fetch'
import type { IssueReference } from './epic-graph'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const EPIC = 858
const GET_BODY = 'issue_get_body'
const FETCH_CHILD = 'fetch_child'
const LOCAL_BODY = 'local body'
const REMOTE_BODY = 'remote body'
const DOTTED_REPO = 'joshuafolkken/site.com'
const ORPHAN_NUMBER = 5

function body_from(repo: string): string {
	return `body from ${repo}`
}

function child_in(number: number, repo: string, body?: string): AuditChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [], body }
}

function child(number: number, body: string): AuditChild {
	return child_in(number, REPO, body)
}

// A search that read the whole backlog — the state every existing case here assumed.
function read_claiming(numbers: Array<number>, cutoff: ScanCutoff = 'none'): ClaimingSearch {
	return { kind: 'read', numbers, cutoff }
}

function audit_input(overrides: Partial<AuditInput> = {}): AuditInput {
	return {
		epic_number: EPIC,
		repo: REPO,
		children: [],
		tracked: [],
		reference_states: new Map(),
		claiming: read_claiming([]),
		anomalies: [],
		contradictions: [],
		...overrides,
	}
}

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('epic_audit_cli.parse_epic_number', () => {
	it('accepts a bare number and a hash-prefixed one', () => {
		expect(epic_audit_cli.parse_epic_number('858')).toBe(EPIC)
		expect(epic_audit_cli.parse_epic_number('#858')).toBe(EPIC)
	})

	it('refuses anything that is not a positive issue number', () => {
		for (const raw of ['', 'abc', '0', '-3']) {
			expect(epic_audit_cli.parse_epic_number(raw)).toBeUndefined()
		}
	})

	it('refuses a cross-repository reference', () => {
		expect(epic_audit_cli.parse_epic_number('joshuafolkken/kit#858')).toBeUndefined()
	})
})

function outside(children: ReadonlyArray<AuditChild>): ReadonlyArray<IssueReference> {
	return epic_audit_cli.outside_references(children, REPO)
}

describe('epic_audit_cli.outside_references', () => {
	it('reports a cited issue that is not a child', () => {
		expect(outside([child(1, 'see #900')])).toEqual([{ repo: REPO, number: 900 }])
	})

	it('leaves out the children themselves', () => {
		expect(outside([child(1, 'see #2'), child(2, '')])).toEqual([])
	})

	// `joshuafolkken/app-kit#12` is another repository's issue 12; reading its tail as a local `#12`
	// produced warnings about issues that were fine. It is read now — as that repository's issue.
	it('reads a repository-qualified reference as that repository', () => {
		expect(outside([child(1, 'see joshuafolkken/app-kit#12')])).toEqual([
			{ repo: OTHER_REPO, number: 12 },
		])
	})

	it('reports each issue once', () => {
		expect(outside([child(1, '#900'), child(2, '#900')])).toEqual([{ repo: REPO, number: 900 }])
	})

	// A child of another repository is not this repository's child of the same number, so the
	// citation is an outside reference here and must still be resolved (joshuafolkken/kit#1014).
	it('keeps a citation a same-numbered child elsewhere used to swallow', () => {
		expect(outside([child(1, 'see #12'), child_in(12, OTHER_REPO)])).toEqual([
			{ repo: REPO, number: 12 },
		])
	})

	// Inherited from joshuafolkken/kit#869: a body mentioning a third party's issue must not send
	// this command to their tracker.
	it('leaves out a repository this owner does not own', () => {
		expect(outside([child(1, 'see sveltejs/kit#900')])).toEqual([])
	})

	// A repository name may contain a dot, and the task list has always tracked one; the prose parse
	// refused it, so a sibling quoting a child it *does* track was skipped in silence
	// (joshuafolkken/kit#1016).
	it('reads a dotted repository name the epic actually tracks', () => {
		const children = [child(1, `see ${DOTTED_REPO}#40`), child_in(40, DOTTED_REPO)]

		expect(outside(children)).toEqual([])
		expect(outside([child(1, `see ${DOTTED_REPO}#41`), child_in(40, DOTTED_REPO)])).toEqual([
			{ repo: DOTTED_REPO, number: 41 },
		])
	})

	// The same shape written in prose is a path, and reading it as a repository is the misread the
	// dot was excluded for. No epic tracks `prompts/review.md`, so it stays prose.
	it('still refuses a path written in prose', () => {
		expect(outside([child(1, 'see prompts/review.md#5')])).toEqual([])
	})
})

async function resolve(
	references: ReadonlyArray<IssueReference>,
): Promise<Map<string, ReferenceState>> {
	return await epic_audit_cli.resolve_reference_states(references, REPO)
}

// Each reference is asked of the repository whose body named it. Asked unqualified, a
// cross-repository child's `#40` was answered by this repository's issue 40 (joshuafolkken/kit#1014).
describe('epic_audit_cli.resolve_reference_states', () => {
	it('asks this repository unqualified and keys the answer by repository and number', async () => {
		const fetch_child = vi.spyOn(epic_fetch, FETCH_CHILD).mockResolvedValue(child_in(900, REPO))
		const states = await resolve([{ repo: REPO, number: 900 }])

		expect(fetch_child).toHaveBeenCalledWith(900, REPO, undefined)
		expect(states.get(`${REPO}#900`)).toBe('OPEN')
	})

	it('asks another repository through its own scope', async () => {
		const closed = { ...child_in(40, OTHER_REPO), state: 'CLOSED' as const }
		const fetch_child = vi.spyOn(epic_fetch, FETCH_CHILD).mockResolvedValue(closed)
		const states = await resolve([{ repo: OTHER_REPO, number: 40 }])

		expect(fetch_child).toHaveBeenCalledWith(40, OTHER_REPO, OTHER_REPO)
		expect(states.get(`${OTHER_REPO}#40`)).toBe('CLOSED')
	})

	// Two issues of the same number in different repositories are two entries, not one.
	it('keeps the same number in two repositories apart', async () => {
		vi.spyOn(epic_fetch, FETCH_CHILD).mockResolvedValue(undefined)
		const states = await resolve([
			{ repo: REPO, number: 40 },
			{ repo: OTHER_REPO, number: 40 },
		])

		expect(states.size).toBe(2)
		expect(states.get(`${OTHER_REPO}#40`)).toBe('UNRESOLVED')
	})
})

describe('epic_audit_cli.audit', () => {
	it('passes an epic with nothing wrong', () => {
		const result = epic_audit_cli.audit(audit_input({ children: [child(1, 'no references')] }))

		expect(result.exit_code).toBe(0)
		expect(result.findings).toEqual([])
	})

	it('fails on a graph anomaly carried in from epic:next', () => {
		const anomaly: AuditFinding = { level: 'error', check: 'cycle', message: 'a cycle' }

		expect(epic_audit_cli.audit(audit_input({ anomalies: [anomaly] })).exit_code).toBe(1)
	})

	// The acceptance criteria are part of the body, so without the hand-off every order contradiction
	// would arrive a second time as a warning.
	it('does not count an order contradiction again as a warning', () => {
		const children = [child(1, '## 受け入れ条件\n\n- [ ] needs #2'), child(2, '')]
		const contradictions: ReadonlyArray<AuditFinding> = [
			{ level: 'error', check: 'order contradiction', message: '#1 names #2 in its criteria' },
		]
		const result = epic_audit_cli.audit(audit_input({ children, contradictions }))

		expect(result.findings).toHaveLength(1)
	})
})

// What check 4 could not cover, as opposed to what it found. Split from the block above because the
// two are separately wrong-able: the check can report its orphans correctly while a search that read
// nothing at all still arrives as a clean report (joshuafolkken/kit#1033).
describe('epic_audit_cli.audit — the orphan search itself', () => {
	it('reports an orphan the task list does not track', () => {
		const result = epic_audit_cli.audit(
			audit_input({ tracked: [1], claiming: read_claiming([1, ORPHAN_NUMBER]) }),
		)

		expect(result.findings).toHaveLength(1)
		expect(result.exit_code).toBe(0)
	})

	// joshuafolkken/kit#1033: folded into `[]`, a failed listing produced exactly the report a
	// backlog with no orphans produces — clean, and with exit 0.
	it('fails the audit when the orphan search could not be read', () => {
		const result = epic_audit_cli.audit(audit_input({ claiming: { kind: 'unreadable' } }))

		expect(result.findings).toHaveLength(1)
		expect(result.exit_code).toBe(1)
	})

	// A cap that is not surfaced is the same defect wearing a different hat, so the report carries it
	// — as a warning, because the scan did run over the newest issues.
	it('warns without failing when the orphan search was cut short', () => {
		const result = epic_audit_cli.audit(
			audit_input({ claiming: read_claiming([], 'page_ceiling') }),
		)

		expect(result.findings.map((finding) => finding.level)).toEqual(['warning'])
		expect(result.exit_code).toBe(0)
	})
})

// The scope every body read goes through. Without it a cross-repository child's body came from
// *this* repository's issue of that number, and all four body-reading checks then ran against the
// wrong text (joshuafolkken/kit#1012).
describe('epic_audit_cli.attach_bodies', () => {
	it('reads a child in this repository unqualified, exactly as before', async () => {
		const get_body = vi.spyOn(git_gh_command, GET_BODY).mockResolvedValue(LOCAL_BODY)
		const attached = await epic_audit_cli.attach_bodies([child_in(1, REPO)], REPO)

		expect(get_body).toHaveBeenCalledWith('1', undefined)
		expect(attached[0]?.body).toBe(LOCAL_BODY)
	})

	it("reads a cross-repository child's body from its own repository", async () => {
		const get_body = vi.spyOn(git_gh_command, GET_BODY).mockResolvedValue(REMOTE_BODY)
		const attached = await epic_audit_cli.attach_bodies([child_in(12, OTHER_REPO)], REPO)

		expect(get_body).toHaveBeenCalledWith('12', OTHER_REPO)
		expect(attached[0]?.body).toBe(REMOTE_BODY)
	})

	// The two live side by side in one epic, so the scope has to be decided per child rather than
	// once for the batch.
	it('gives each child the body read from its own repository', async () => {
		vi.spyOn(git_gh_command, GET_BODY).mockImplementation(async (_number, repo) =>
			repo === undefined ? LOCAL_BODY : body_from(repo),
		)
		const attached = await epic_audit_cli.attach_bodies(
			[child_in(1, REPO), child_in(12, OTHER_REPO)],
			REPO,
		)

		expect(attached.map((entry) => entry.body)).toEqual([LOCAL_BODY, body_from(OTHER_REPO)])
	})
})
