import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpicChild } from './epic-graph'
import { epic_remove, type RemoveOrderInput } from './epic-remove'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_edit_body: vi.fn(),
		issue_try_comment: vi.fn(),
	},
}))

vi.mock('./epic-read', () => ({
	epic_read: { read_epic: vi.fn() },
}))

vi.mock(import('./epic-relations'), async (import_original) => {
	const original = await import_original()

	return { epic_relations: { ...original.epic_relations, apply_relations: vi.fn() } }
})

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { epic_read } = await import('./epic-read')
const { epic_relations } = await import('./epic-relations')
const mocked_edit_body = vi.mocked(git_gh_command.issue_edit_body)
const mocked_comment = vi.mocked(git_gh_command.issue_try_comment)
const mocked_read_epic = vi.mocked(epic_read.read_epic)
const mocked_apply_relations = vi.mocked(epic_relations.apply_relations)

const REPO = 'joshuafolkken/kit'
const EPIC = 900
const CHAIN = '#101 -> #102 -> #103'
const FIRST_LINK = '#101 -> #102'
const UNORDERED = 'None — the children are independent; any execution order works.'
const RECORD = 'The order was never justified.'
const FAILURE = 1
const SUCCESS = 0

function body_of(declaration: string): string {
	return [
		'## Progress',
		'',
		'- [ ] #101',
		'- [ ] #102',
		'- [ ] #103',
		'',
		'## Dependencies',
		'',
		declaration,
	].join('\n')
}

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker })),
	}
}

function read_as(declaration: string): void {
	mocked_read_epic.mockResolvedValue({
		subject: { number: EPIC, labels: ['epic'], body: body_of(declaration) },
		recorded: [child(101), child(102, [101]), child(103, [102])],
		repo: REPO,
	})
}

async function remove(
	path: ReadonlyArray<number>,
	decision?: RemoveOrderInput['decision'],
): Promise<number> {
	return await epic_remove.remove_order({ epic_number: EPIC, path, decision })
}

function written_body(): string {
	return mocked_edit_body.mock.calls[0]?.[1] ?? ''
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_edit_body.mockResolvedValue('')
	mocked_comment.mockResolvedValue(true)
	mocked_apply_relations.mockResolvedValue(0)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('remove_order — refusals write nothing', () => {
	it('fails without editing when the epic cannot be read', async () => {
		mocked_read_epic.mockResolvedValue({ error: 'Could not read issue #900.' })

		await expect(remove([101, 102])).resolves.toBe(FAILURE)
		expect(mocked_edit_body).not.toHaveBeenCalled()
		expect(mocked_apply_relations).not.toHaveBeenCalled()
	})

	it('fails without editing when the path names an undeclared order', async () => {
		read_as(FIRST_LINK)

		await expect(remove([102, 103])).resolves.toBe(FAILURE)
		expect(mocked_edit_body).not.toHaveBeenCalled()
		expect(mocked_apply_relations).not.toHaveBeenCalled()
	})
})

describe('remove_order — the write', () => {
	it('never reconnects the ends around a removed middle child', async () => {
		read_as(CHAIN)

		await expect(remove([101, 102, 103])).resolves.toBe(SUCCESS)
		expect(mocked_edit_body).toHaveBeenCalledWith(String(EPIC), expect.any(String))
		expect(written_body()).not.toContain('#101 -> #103')
	})

	it('writes the unordered sentence when the last declared link goes', async () => {
		read_as(FIRST_LINK)

		await remove([101, 102])

		expect(written_body()).toContain(UNORDERED)
		expect(written_body()).not.toContain(FIRST_LINK)
	})

	it('drops the native relations the removed orders were backed by', async () => {
		read_as(CHAIN)

		await remove([101, 102])

		expect(mocked_apply_relations).toHaveBeenCalledWith([{ blocker: 101, blocked: 102 }], 'drop')
	})

	it('posts no decision comment when no record was given', async () => {
		read_as(CHAIN)

		await remove([101, 102])

		expect(mocked_comment).not.toHaveBeenCalled()
	})

	it('posts the decision on both ends of every removed order', async () => {
		read_as(CHAIN)

		await remove([101, 102], RECORD)

		expect(mocked_comment).toHaveBeenCalledTimes(2)
		expect(mocked_comment).toHaveBeenCalledWith('101', RECORD)
		expect(mocked_comment).toHaveBeenCalledWith('102', RECORD)
	})
})
