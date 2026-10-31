import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cli } from './issue-file-cli'
import { session_cite } from './session-cite'
import { upstream_interrupt_cli } from './upstream-interrupt-cli'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const FINDER = '5546'
const TITLE = 'Root cause title'
const FIRST_PARTY_REPO = 'joshuafolkken/kit'
const THIRD_PARTY_REPO = 'sveltejs/kit'
const FILED_URL = 'https://github.com/joshuafolkken/kit/issues/9001'
const COMMENT_URL = 'https://github.com/joshuafolkken/kit/issues/5546#issuecomment-1'
const DRAFT = 'Minimal reproduction and expected result.'
const STASH_MESSAGE = 'upstream-interrupt: paused #5546'
const BODY_FILE_FLAG = '--body-file'
const REPO_FLAG = '--repo'
const BLOCKS_FINDER_FLAG = '--blocks-finder'
const BODY_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'upstream-interrupt-test-'))
const BODY_FILE = path.join(BODY_DIRECTORY, 'body.md')

await writeFile(BODY_FILE, DRAFT)

function argv_for(repo: string, extra: ReadonlyArray<string> = []): ReadonlyArray<string> {
	return [FINDER, TITLE, REPO_FLAG, repo, BODY_FILE_FLAG, BODY_FILE, ...extra]
}

function stdout_lines(): ReadonlyArray<string> {
	return vi.mocked(console.info).mock.calls.map((call) => String(call[0]))
}

function stderr_text(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

function posted_body(): string {
	return String(vi.mocked(git_gh_command.issue_comment).mock.calls[0]?.[1])
}

function call_order(mocked: { mock: { invocationCallOrder: ReadonlyArray<number> } }): number {
	return mocked.mock.invocationCallOrder[0] ?? 0
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.spyOn(stash_push_cli, 'set_aside').mockResolvedValue('stashed')
	vi.spyOn(issue_file_cli, 'file_issue').mockResolvedValue(FILED_URL)
	vi.spyOn(git_gh_command, 'issue_comment').mockResolvedValue(COMMENT_URL)
	vi.spyOn(telegram_notify, 'confirm').mockResolvedValue(true)
})

describe('josh upstream:interrupt to a first-party repository', () => {
	it('stashes, files, backlinks and notifies in order, one line each', async () => {
		const code = await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO, [BLOCKS_FINDER_FLAG]))

		expect(code).toBe(SUCCESS_EXIT_CODE)
		const order = [
			call_order(vi.mocked(stash_push_cli.set_aside)),
			call_order(vi.mocked(issue_file_cli.file_issue)),
			call_order(vi.mocked(git_gh_command.issue_comment)),
			call_order(vi.mocked(telegram_notify.confirm)),
		]

		expect(order).toStrictEqual([...order].toSorted((left, right) => left - right))
		expect(stdout_lines()).toStrictEqual([
			session_cite.text(`stash: stashed "${STASH_MESSAGE}"`),
			`file: ${FILED_URL}`,
			`comment: ${COMMENT_URL}`,
			'notify: confirmation sent',
		])
	})
})

describe('josh upstream:interrupt filing and backlink', () => {
	it('files on the interrupt route with --blocks-finder passed through', async () => {
		await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO, [BLOCKS_FINDER_FLAG]))

		expect(vi.mocked(stash_push_cli.set_aside)).toHaveBeenCalledWith({
			message: STASH_MESSAGE,
			dir: undefined,
		})
		expect(vi.mocked(issue_file_cli.file_issue)).toHaveBeenCalledWith([
			TITLE,
			BODY_FILE_FLAG,
			BODY_FILE,
			'--route',
			'interrupt',
			REPO_FLAG,
			FIRST_PARTY_REPO,
			BLOCKS_FINDER_FLAG,
		])
	})

	it('backlinks the filed reference under ## Upstream issues on the finder', async () => {
		await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO))

		expect(vi.mocked(git_gh_command.issue_comment)).toHaveBeenCalledWith(FINDER, posted_body())
		expect(posted_body()).toContain('## Upstream issues\n\n- joshuafolkken/kit#9001')
		expect(posted_body()).toContain(`pnpm josh stash:pop "${STASH_MESSAGE}"`)
	})
})

describe('josh upstream:interrupt to a third-party repository', () => {
	it('files nothing and leaves the draft under ## Upstream candidate on the finder', async () => {
		const code = await upstream_interrupt_cli.run(argv_for(THIRD_PARTY_REPO))

		expect(code).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(issue_file_cli.file_issue)).not.toHaveBeenCalled()
		expect(posted_body()).toContain('## Upstream candidate')
		expect(posted_body()).not.toContain('## Upstream issues')
		expect(posted_body()).toContain(DRAFT)
		expect(vi.mocked(telegram_notify.confirm)).toHaveBeenCalledTimes(1)
	})
})

describe('josh upstream:interrupt on a failing step', () => {
	it('runs no later step when the filing refuses, and prints the step and the re-run', async () => {
		vi.mocked(issue_file_cli.file_issue).mockResolvedValue(undefined)

		const code = await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO))

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(git_gh_command.issue_comment)).not.toHaveBeenCalled()
		expect(vi.mocked(telegram_notify.confirm)).not.toHaveBeenCalled()
		expect(stderr_text()).toContain('stopped at file')
		expect(stderr_text()).toContain(
			`re-run: \`pnpm josh upstream:interrupt ${FINDER} 'Root cause title'`,
		)
	})

	it('files nothing when the stash fails', async () => {
		vi.mocked(stash_push_cli.set_aside).mockRejectedValue(new Error('unmerged paths'))

		const code = await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO))

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(issue_file_cli.file_issue)).not.toHaveBeenCalled()
		expect(stderr_text()).toContain('stopped at stash: unmerged paths')
	})

	it('sends no confirmation when the backlink fails, and prints the comment to re-run', async () => {
		vi.mocked(git_gh_command.issue_comment).mockRejectedValue(new Error('gh failed'))

		const code = await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO))

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(telegram_notify.confirm)).not.toHaveBeenCalled()
		expect(stderr_text()).toMatch(
			/stopped at comment: gh failed — re-run: `pnpm josh issue:comment 5546 --body-file \S+`/u,
		)
	})
})

describe('josh upstream:interrupt on a confirmation that is not sent', () => {
	it('prints the notify to re-run when the confirmation is not sent', async () => {
		vi.mocked(telegram_notify.confirm).mockResolvedValue(false)

		const code = await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO))

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(stderr_text()).toContain('stopped at notify')
		expect(stderr_text()).toContain('pnpm josh notify --task-type confirmation --body-file')
	})
})

describe('josh upstream:interrupt refusals', () => {
	it('writes nothing for an unknown party', async () => {
		vi.mocked(repo_party.current_owner).mockReturnValue(undefined)

		const code = await upstream_interrupt_cli.run(argv_for(FIRST_PARTY_REPO))

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(stash_push_cli.set_aside)).not.toHaveBeenCalled()
		expect(stderr_text()).toContain('unknown party')
	})

	it.each([
		['no repo', [FINDER, TITLE, BODY_FILE_FLAG, BODY_FILE]],
		['no title', [FINDER, REPO_FLAG, FIRST_PARTY_REPO, BODY_FILE_FLAG, BODY_FILE]],
		['a non-number finder', ['abc', TITLE, REPO_FLAG, FIRST_PARTY_REPO, BODY_FILE_FLAG, BODY_FILE]],
		['an unknown flag', [...argv_for(FIRST_PARTY_REPO), '--unknown']],
	])('prints the usage for %s', async (_case, argv) => {
		const code = await upstream_interrupt_cli.run(argv)

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(stash_push_cli.set_aside)).not.toHaveBeenCalled()
		expect(stderr_text()).toContain('Usage: josh upstream:interrupt')
	})
})
