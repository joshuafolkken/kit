import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_release_class_cli } from './issue-release-class-cli'

const { issue_get_body, issue_edit_body } = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue: string, body: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body, issue_edit_body },
}))

const BODY = '## 背景\n\n- 種別: 非不具合\n\n## 受け入れ条件\n\n- [ ] x\n'
const DECLARED =
	'## 背景\n\n- 種別: 非不具合\n- リリース分類: enhancement\n\n## 受け入れ条件\n\n- [ ] x\n'
const ARGS = ['6636', 'enhancement']
const NETWORK_FAILURE = 'network failure'

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	issue_get_body.mockResolvedValue(BODY)
	issue_edit_body.mockResolvedValue('https://github.com/o/r/issues/6636')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_release_class_cli.run', () => {
	it('passes dispatcher arguments through the executable entry', async () => {
		expect(
			await main_entry_fixture.run_entry('scripts/issue/issue-release-class-cli.ts', ARGS),
		).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith('6636', DECLARED)
	})

	it('writes one declaration line into the body (ac-172cafb3)', async () => {
		expect(await issue_release_class_cli.run(ARGS)).toBe(0)
		expect(issue_get_body).toHaveBeenCalledWith('6636')
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith('6636', DECLARED)
	})

	it('does not write on a repeat', async () => {
		issue_get_body.mockResolvedValue(DECLARED)

		expect(await issue_release_class_cli.run(ARGS)).toBe(0)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})

describe('issue_release_class_cli.run refusals', () => {
	it.each(
		[
			['6636', 'bugfix'],
			['6636', 'breaking-change'],
			['6636', 'Enhancement'],
		].map((args) => ({ args })),
	)('refuses the value in $args without reading GitHub (ac-ef6ad62c)', async ({ args }) => {
		expect(await issue_release_class_cli.run(args)).toBe(1)
		expect(issue_get_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('enhancement|other-change'))
	})

	it.each(
		[
			[],
			['6636'],
			['0', 'enhancement'],
			['6636', 'enhancement', 'extra'],
			[...ARGS, '--bogus'],
		].map((args) => ({ args })),
	)('refuses invalid arguments $args without reading GitHub', async ({ args }) => {
		expect(await issue_release_class_cli.run(args)).toBe(1)
		expect(issue_get_body).not.toHaveBeenCalled()
	})
})

describe('issue_release_class_cli.run failures', () => {
	it('reports an unreadable body', async () => {
		issue_get_body.mockResolvedValue(undefined)

		expect(await issue_release_class_cli.run(ARGS)).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it.each(['read', 'write'])('reports a failed %s', async (operation) => {
		const mock = operation === 'read' ? issue_get_body : issue_edit_body

		mock.mockRejectedValue(new Error(NETWORK_FAILURE))

		expect(await issue_release_class_cli.run(ARGS)).toBe(1)
		expect(console.error).toHaveBeenCalledWith(NETWORK_FAILURE)
	})
})
