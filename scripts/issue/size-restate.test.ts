import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_keys } from './issue-body-keys'
import { size_restate } from './size-restate'

// joshuafolkken/kit#5758, #7726: a record's estimate line replaces the issue's own. The write is mocked.

const { issue_edit_body } = vi.hoisted(() => ({
	issue_edit_body: vi.fn<(issue_number: string, body: string, repo?: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_edit_body } }))

const BACKGROUND = issue_body_keys.heading('background')
const SIZE_PREFIX = issue_body_keys.prefix('size')
const OLD = `${SIZE_PREFIX} ${issue_body_keys.size_value('6', '110')}`
const NEW = `${SIZE_PREFIX} ${issue_body_keys.size_value('8', '160')}`
const OTHER_REPO = 'joshuafolkken/kit'

function body_of(line: string): string {
	return [BACKGROUND, line].join('\n')
}

beforeEach(() => {
	issue_edit_body.mockResolvedValue('')
})

describe('size_restate.apply — the record’s estimate replaces the issue’s', () => {
	it('writes the restated body to the named repository', async () => {
		expect(await size_restate.apply('7', body_of(OLD), `## Plan\n${NEW}`, OTHER_REPO)).toBe(true)
		expect(issue_edit_body).toHaveBeenCalledWith('7', body_of(NEW), OTHER_REPO)
	})

	it.each([
		{ name: 'the record states no estimate', record: '## Plan' },
		{ name: 'the issue already declares it', record: NEW },
	])('writes nothing when $name', async (row) => {
		expect(await size_restate.apply('7', body_of(NEW), row.record)).toBe(true)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('is false when the write fails', async () => {
		issue_edit_body.mockRejectedValue(new Error('gh failed'))

		expect(await size_restate.apply('7', body_of(OLD), NEW)).toBe(false)
	})
})
