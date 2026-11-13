import { KICKOFF_BODY, USER_PROHIBITION } from '#scripts/auto-ok/auto-ok-kickoff-fixture'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_body } from '#scripts/epic/epic-body'
import { epic_classify } from '#scripts/epic/epic-classify'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_live } from '#scripts/epic/epic-live'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { issue_publication } from './issue-publication'
import { issue_publication_state } from './issue-publication-state'

const REPO = 'joshuafolkken/kit'
const EPIC = 7430
const FIRST = 7428
const LAST = 7429
const CHILDREN = [FIRST, LAST]
const MISSING = 'missing child'
const PLANNED = 'run:planned'
const INTERRUPTED = 'process terminated'
const rows = new Map<number, EpicChild>()
const relations = new Map<number, Array<{ repo: string; number: number }>>()
const write = vi.spyOn(git_gh_exec, 'exec_gh_api')

function child(number: number): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: [],
		body: issue_publication_state.prepare(KICKOFF_BODY, ['auto-ok', 'run:lane']),
	}
}

function read(number: number): EpicChild {
	const row = rows.get(number)
	if (row === undefined) throw new Error(MISSING)

	return row
}

function expect_withheld(): void {
	expect(epic_classify.classify_children(CHILDREN.map((number) => read(number))).runnable).toEqual(
		[],
	)
}

function plan_children(): void {
	for (const number of CHILDREN) rows.set(number, { ...read(number), labels: [PLANNED] })
}

function expect_published(): void {
	expect(read(FIRST).labels).toContain('auto-ok')
	expect(issue_publication_state.is_pending(read(LAST).body)).toBe(false)
}

async function apply_write(request: GhApiRequest): Promise<string> {
	const number = Number(request.path.split('/').at(-1))
	const patch: { body: string; labels: Array<string> } = JSON.parse(request.body ?? '{}')

	rows.set(number, { ...read(number), ...patch })

	return ''
}

beforeEach(() => {
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	rows.clear()
	relations.clear()
	for (const number of CHILDREN) rows.set(number, child(number))
	rows.set(EPIC, {
		...child(EPIC),
		labels: ['epic'],
		body: epic_body.build_epic_body({
			children: CHILDREN,
			rationale: 'Dependency order',
			is_ordered: true,
		}),
	})
	vi.spyOn(epic_live, 'child').mockImplementation(async (number) => read(number))
	vi.spyOn(epic_live, 'blockers').mockImplementation(async (number) => relations.get(number) ?? [])
	write.mockImplementation(apply_write)
})

afterEach(() => vi.clearAllMocks())
afterAll(() => vi.restoreAllMocks())

it('withholds every child at creation, plan and relation boundaries until validation and publication', async () => {
	expect_withheld()
	await expect(issue_publication.publish(EPIC, REPO)).rejects.toThrow('recorded plan')
	plan_children()
	expect_withheld()
	await expect(issue_publication.publish(EPIC, REPO)).rejects.toThrow('unrecorded dependencies')
	expect(write).not.toHaveBeenCalled()
	relations.set(LAST, [{ number: FIRST, repo: REPO }])
	expect_withheld()
	await issue_publication.publish(EPIC, REPO)
	expect_published()
})

function ready(): void {
	plan_children()
	relations.set(LAST, [{ number: FIRST, repo: REPO }])
}

it('publishes a newly prohibited child without restoring its saved approval', async () => {
	ready()
	rows.set(FIRST, { ...read(FIRST), body: `${read(FIRST).body ?? ''}${USER_PROHIBITION}` })
	await issue_publication.publish(EPIC, REPO)

	expect(read(FIRST).labels).not.toContain('auto-ok')
	expect(read(FIRST).body).toContain(USER_PROHIBITION.trim())
	expect(issue_publication_state.is_pending(read(FIRST).body)).toBe(false)
})

it('recovers an interrupted publish without recreating or republishing completed children', async () => {
	ready()
	write.mockImplementationOnce(apply_write).mockRejectedValueOnce(new Error(INTERRUPTED))
	await expect(issue_publication.publish(EPIC, REPO)).rejects.toThrow(INTERRUPTED)
	expect(issue_publication_state.is_pending(read(FIRST).body)).toBe(false)
	expect(issue_publication_state.is_pending(read(LAST).body)).toBe(true)
	write.mockImplementation(apply_write)
	await issue_publication.publish(EPIC, REPO)
	expect_published()
})

it('skips already published children on a duplicate publication', async () => {
	ready()
	await issue_publication.publish(EPIC, REPO)
	write.mockClear()
	await issue_publication.publish(EPIC, REPO)
	expect(write).not.toHaveBeenCalled()
})

it('makes no publication write when a later child cannot be read', async () => {
	ready()
	rows.delete(LAST)
	await expect(issue_publication.publish(EPIC, REPO)).rejects.toThrow(MISSING)
	expect(write).not.toHaveBeenCalled()
	expect(issue_publication_state.is_pending(read(FIRST).body)).toBe(true)
})

it('refuses a foreign tracker before reading or writing its issues', async () => {
	await expect(issue_publication.publish(EPIC, 'another-owner/kit')).rejects.toThrow(
		'known first-party',
	)
	expect(epic_live.child).not.toHaveBeenCalled()
	expect(write).not.toHaveBeenCalled()
})
