import { git_gh_command } from '#scripts/git/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditFinding } from './epic-audit'
import type { AuditChild } from './epic-audit-checks'
import { epic_audit_cli, type AuditInput } from './epic-audit-cli'
import type { EpicSnapshot } from './epic-fetch'

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const EPIC = 858
const GET_BODY = 'issue_get_body'
const LOCAL_BODY = 'local body'
const REMOTE_BODY = 'remote body'

function body_from(repo: string): string {
	return `body from ${repo}`
}

function child_in(number: number, repo: string, body?: string): AuditChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [], body }
}

function child(number: number, body: string): AuditChild {
	return child_in(number, REPO, body)
}

function snapshot(overrides: Partial<EpicSnapshot> = {}): EpicSnapshot {
	return {
		body: undefined,
		children: [],
		child_numbers: [1],
		unreadable: [],
		skipped: [],
		has_external_children: false,
		...overrides,
	}
}

function audit_input(overrides: Partial<AuditInput> = {}): AuditInput {
	return {
		epic_number: EPIC,
		children: [],
		tracked: [],
		reference_states: new Map(),
		claiming: [],
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

describe('epic_audit_cli.claims_parent', () => {
	it('recognizes the parent line the templates write', () => {
		expect(epic_audit_cli.claims_parent('親: joshuafolkken/kit#858', EPIC)).toBe(true)
	})

	it('recognizes the English spelling', () => {
		expect(epic_audit_cli.claims_parent('Parent: #858', EPIC)).toBe(true)
	})

	// An issue parented to a different epic routinely backlinks this one elsewhere in its body;
	// matching the marker and the number independently reported every such issue as an orphan.
	it('does not claim an issue whose parent line names a different epic', () => {
		const body = '親: joshuafolkken/kit#900\n\nRelated to #858 for context.'

		expect(epic_audit_cli.claims_parent(body, EPIC)).toBe(false)
	})

	it('does not claim an issue that merely mentions the epic', () => {
		expect(epic_audit_cli.claims_parent('see #858', EPIC)).toBe(false)
	})

	// `gh issue list --json body` answers with JSON null for an issue that has none.
	it('handles a body gh reported as null', () => {
		// eslint-disable-next-line unicorn/no-null -- the shape gh's JSON actually produces
		expect(epic_audit_cli.claims_parent(null, EPIC)).toBe(false)
	})
})

describe('epic_audit_cli.outside_references', () => {
	it('reports a cited issue that is not a child', () => {
		expect(epic_audit_cli.outside_references([child(1, 'see #900')])).toEqual([900])
	})

	it('leaves out the children themselves', () => {
		expect(epic_audit_cli.outside_references([child(1, 'see #2'), child(2, '')])).toEqual([])
	})

	// `joshuafolkken/app-kit#12` is another repository's issue 12; reading its tail as a local `#12`
	// produced warnings about issues that were fine.
	it('does not read the tail of a repository-qualified reference', () => {
		expect(epic_audit_cli.outside_references([child(1, 'see joshuafolkken/app-kit#12')])).toEqual(
			[],
		)
	})

	it('reports each number once', () => {
		expect(epic_audit_cli.outside_references([child(1, '#900'), child(2, '#900')])).toEqual([900])
	})
})

// `epic:next` refuses to run on an epic with a child it could not read; an audit reporting a clean
// bill on the same input would contradict the command that acts on it.
describe('epic_audit_cli.unreadable_findings', () => {
	it('reports a child that could not be read as an error', () => {
		const findings = epic_audit_cli.unreadable_findings(snapshot({ unreadable: [7] }))

		expect(findings[0]?.level).toBe('error')
		expect(findings[0]?.message).toContain('#7')
	})

	it('reports children dropped past the fetch limit too', () => {
		expect(epic_audit_cli.unreadable_findings(snapshot({ skipped: [8] }))).toHaveLength(1)
	})

	it('reports nothing when every child was read', () => {
		expect(epic_audit_cli.unreadable_findings(snapshot())).toEqual([])
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

	it('reports an orphan the task list does not track', () => {
		const result = epic_audit_cli.audit(audit_input({ tracked: [1], claiming: [1, 5] }))

		expect(result.findings).toHaveLength(1)
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
