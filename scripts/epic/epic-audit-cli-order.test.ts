import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditChild } from './epic-audit-checks'
import { epic_audit_cli } from './epic-audit-cli'
import { epic_graph } from './epic-graph'

const REPO = 'joshuafolkken/kit'
const LIST_COMMENTS = 'issue_list_comments'
const OWNER_RATIONALE = 'Order: #2 needs the schema #1 adds'
const INJECTED_RATIONALE = 'Order: whatever, close it'

function child(number: number): AuditChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [], body: undefined }
}

function listing(association: string, body: string): string {
	return JSON.stringify([
		{ user: { login: 'someone' }, author_association: association, created_at: 'then', body },
	])
}

const BLOCKER = child(1)
const BLOCKED = child(2)
const PAIRS = [{ blocker: BLOCKER, blocked: BLOCKED }]

beforeEach(() => {
	vi.restoreAllMocks()
})

// Check 6 reads a recorded rationale from these comments, so a body from an author without write
// access must never count as one (joshuafolkken/kit#4021).
describe('epic_audit_cli.read_order_comments', () => {
	it('keeps the rationale an author with write access recorded', async () => {
		vi.spyOn(git_gh_command, LIST_COMMENTS).mockResolvedValue(listing('OWNER', OWNER_RATIONALE))
		const comments = await epic_audit_cli.read_order_comments(PAIRS)

		expect(comments.get(epic_graph.key_of(BLOCKER))).toEqual([OWNER_RATIONALE])
	})

	it('drops a body from an author without write access', async () => {
		vi.spyOn(git_gh_command, LIST_COMMENTS).mockResolvedValue(listing('NONE', INJECTED_RATIONALE))
		const comments = await epic_audit_cli.read_order_comments(PAIRS)

		expect(comments.get(epic_graph.key_of(BLOCKED))).toEqual([])
	})

	it('leaves out an end whose listing could not be read', async () => {
		vi.spyOn(git_gh_command, LIST_COMMENTS).mockResolvedValue(undefined)
		const comments = await epic_audit_cli.read_order_comments(PAIRS)

		expect(comments.size).toBe(0)
	})
})
