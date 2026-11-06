import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read } from '#scripts/issue/issue-read'
import { file_reader } from '#scripts/lib/read-file'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan_approval } from './lane-plan-approval'

const ISSUE = 6594
const SOURCE = 'https://github.com/joshuafolkken/kit/issues/6594#issuecomment-6687208090'
const FILE = '.josh/tmp/size-approval.json'
const ONE_FILE = 'one.ts'
const FLAG = '--size-approval'
const SCOPE = {
	issue: ISSUE,
	paths: ['scripts/lane/lane-size-stats.ts'],
	declared_lines: 170,
	max_lines: 204,
	source: SOURCE,
	rationale: 'Human approved this Issue at 204 projected lines; retain all quality gates.',
}
const COMMENT = {
	html_url: SOURCE,
	author: 'joshuafolkken',
	created_at: '2026-11-06T14:29:30Z',
	body: '## #6594 の再分割しない例外承認\n170 × 1.2 = 204 行。品質ゲートは省略しない。',
	is_trusted: true,
}
const read_file = vi.spyOn(file_reader, 'read_if_readable')
const comments = vi.spyOn(git_gh_issue_read, 'issue_list_comments')
const parse = vi.spyOn(issue_read, 'parse_comments')

beforeEach(() => {
	read_file.mockReturnValue(JSON.stringify(SCOPE))
	comments.mockResolvedValue('[]')
	parse.mockResolvedValue([COMMENT])
})

describe('lane plan size approval source', () => {
	it('records the trusted human comment beside its exact bounded scope', async () => {
		expect(await lane_plan_approval.read(FILE, ISSUE)).toEqual({
			...SCOPE,
			author: COMMENT.author,
			body: COMMENT.body,
		})
		expect(comments).toHaveBeenCalledWith(String(ISSUE))
	})

	it.each([false, undefined])('refuses trust %s', async (is_trusted) => {
		parse.mockResolvedValue([{ ...COMMENT, is_trusted }])

		expect(await lane_plan_approval.read(FILE, ISSUE)).toBeUndefined()
	})

	it.each([undefined, []])('refuses a missing or unreadable comment %j', async (rows) => {
		parse.mockResolvedValue(rows)

		expect(await lane_plan_approval.read(FILE, ISSUE)).toBeUndefined()
	})

	it('does not accept another trusted comment as the cited approval', async () => {
		parse.mockResolvedValue([{ ...COMMENT, html_url: `${SOURCE}0` }])

		expect(await lane_plan_approval.read(FILE, ISSUE)).toBeUndefined()
	})

	it('never reads approval comments from a different Issue', async () => {
		expect(await lane_plan_approval.read(FILE, ISSUE + 1)).toBeUndefined()
		expect(comments).not.toHaveBeenCalled()
	})

	it.each([undefined, '', '{', '{}'])('refuses malformed scope %s', async (text) => {
		read_file.mockReturnValue(text)

		expect(await lane_plan_approval.read(FILE, ISSUE)).toBeUndefined()
	})
})

describe('lane plan size approval arguments', () => {
	it('removes only the explicit approval file argument', () => {
		expect(lane_plan_approval.split(['6594', ONE_FILE, FLAG, FILE])).toEqual({
			tokens: ['6594', ONE_FILE],
			file: FILE,
		})
	})

	it('keeps a missing value invalid instead of silently applying no approval', () => {
		expect(lane_plan_approval.split(['6594', ONE_FILE, FLAG]).file).toBe('')
	})
})
