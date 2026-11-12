import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trusted_measure_source } from './trusted-measure-source'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_view_json: vi.fn() },
}))

const SOURCE = {
	body: 'verified snapshot',
	authorAssociation: 'OWNER',
	author: { login: 'author' },
	editor: { login: 'editor' },
	lastEditedAt: '2026-11-04T00:00:00Z',
}
const INVALID_JSON = 'invalid json'

beforeEach(() => {
	vi.mocked(git_gh_issue_read.issue_view_json).mockReset().mockResolvedValue('{"node_id":"node"}')
	vi.mocked(git_gh_exec.exec_gh_api)
		.mockReset()
		.mockResolvedValue(JSON.stringify({ data: { node: SOURCE } }))
})

describe('trusted_measure_source.read', () => {
	it('reads the body and both identities from one GraphQL snapshot keyed to the issue', async () => {
		await expect(trusted_measure_source.read('6246')).resolves.toStrictEqual(SOURCE)
		expect(git_gh_issue_read.issue_view_json).toHaveBeenCalledWith('6246', 'node_id')
		const request = vi.mocked(git_gh_exec.exec_gh_api).mock.calls[0]?.[0]
		const body = request?.body

		expect(request?.path).toBe('graphql')
		expect(body).toContain('"variables":{"id":"node"}')
		expect(body).toContain('editor { login }')
		expect(body).not.toContain('lastEditedBy')
	})

	it.each([undefined, '{}', INVALID_JSON])(
		'refuses a missing or malformed node ID: %s',
		async (rest) => {
			vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(rest)

			await expect(trusted_measure_source.read('6246')).resolves.toBeUndefined()
			expect(git_gh_exec.exec_gh_api).not.toHaveBeenCalled()
		},
	)

	it.each(['{}', '{"data":{"node":null}}', INVALID_JSON])(
		'refuses missing provenance or an unreadable response: %s',
		async (json) => {
			vi.mocked(git_gh_exec.exec_gh_api).mockResolvedValue(json)

			await expect(trusted_measure_source.read('6246')).resolves.toBeUndefined()
		},
	)

	it('refuses a failed GraphQL request', async () => {
		vi.mocked(git_gh_exec.exec_gh_api).mockRejectedValue(new Error('HTTP 403'))

		await expect(trusted_measure_source.read('6246')).resolves.toBeUndefined()
	})
})
