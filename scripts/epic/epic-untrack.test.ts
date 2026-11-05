import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_add_fixture, EPIC_FIXTURE_REPO } from './epic-add-fixture'
import { epic_parse } from './epic-parse'
import { epic_read } from './epic-read'
import { epic_relations } from './epic-relations'
import { epic_untrack } from './epic-untrack'

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_edit_body: vi.fn() } }))
vi.mock('./epic-read', () => ({ epic_read: { read_epic: vi.fn() } }))
vi.mock(import('./epic-relations'), async (original) => {
	const imported = await original()

	return { epic_relations: { ...imported.epic_relations, apply_relations: vi.fn() } }
})

const EPIC = 900
const FAILURE = 1
const SUCCESS = 0
const { body_of, child } = epic_add_fixture
const edit = vi.mocked(git_gh_command.issue_edit_body)
const read = vi.mocked(epic_read.read_epic)
const apply = vi.mocked(epic_relations.apply_relations)
const BODY = body_of(['#101 -> #102 -> #103'], [101, 102, 103])

beforeEach(() => {
	read.mockResolvedValue({
		subject: { number: EPIC, labels: ['epic'], body: BODY },
		repo: EPIC_FIXTURE_REPO,
		recorded: [child(101), child(102, [101]), child(103, [102])],
	})
	apply.mockResolvedValue(0)
	edit.mockResolvedValue('')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('untrack children (ac-d354226c)', () => {
	it('drops connected relations before removing rows without reconnecting survivors', async () => {
		apply.mockImplementation(async () => {
			expect(edit).not.toHaveBeenCalled()

			return 0
		})
		await expect(epic_untrack.untrack(EPIC, [102])).resolves.toBe(SUCCESS)
		expect(apply).toHaveBeenCalledWith(
			[
				{ blocker: 101, blocked: 102 },
				{ blocker: 102, blocked: 103 },
			],
			'drop',
		)
		const body = edit.mock.calls[0]?.[1] ?? ''

		expect(epic_parse.parse_task_list_issue_numbers(body)).toEqual([101, 103])
		expect(epic_parse.parse_dependency_links(body)).toEqual([])
	})

	it('retains the original rows on partial failure and permits the same input again', async () => {
		apply.mockResolvedValueOnce(FAILURE)
		await expect(epic_untrack.untrack(EPIC, [102])).resolves.toBe(FAILURE)
		expect(edit).not.toHaveBeenCalled()
		await expect(epic_untrack.untrack(EPIC, [102])).resolves.toBe(SUCCESS)
		expect(edit).toHaveBeenCalledTimes(1)
	})
})

describe('untrack validation and retry', () => {
	it('does not rewrite an already absent child', async () => {
		await expect(epic_untrack.untrack(EPIC, [104])).resolves.toBe(SUCCESS)
		expect(edit).not.toHaveBeenCalled()
	})

	it('refuses unreadable epics and invalid remaining bodies before any mutation', async () => {
		await expect(epic_untrack.untrack(EPIC, [101, 102, 103])).resolves.toBe(FAILURE)
		read.mockResolvedValue({ error: 'Cannot read epic.' })
		await expect(epic_untrack.untrack(EPIC, [102])).resolves.toBe(FAILURE)
		expect(apply).not.toHaveBeenCalled()
		expect(edit).not.toHaveBeenCalled()
	})
})
