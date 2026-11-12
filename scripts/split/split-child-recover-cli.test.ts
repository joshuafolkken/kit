import path from 'node:path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { split_child_recover_cli } from './split-child-recover-cli'
import { split_resolution } from './split-resolution'

const REPO = 'joshuafolkken/kit'
const ORIGIN = '6212'
const CHILD = 6326
const URL = `https://github.com/${REPO}/issues/${String(CHILD)}`
const BODY = `## 受け入れ条件\n- [ ] #${ORIGIN}\n\nparent: #${ORIGIN}`
const OTHER_PARENT = 'parent: #1'
const LEDGER_NAME = 'ledger.jsonl'
const make_directory = temporary_directory('suite')
const scratch = make_directory('split-child-recover-')
const ledger_path = path.join(scratch, LEDGER_NAME)
const NOTICE: LedgerEntry = {
	kind: 'split-notice',
	at: '2026-11-04T00:00:00.000Z',
	issue: Number(ORIGIN),
	files: 9,
	lines: 201,
}
const original_write = lane_ledger_write.record_split_filed
const read = vi.spyOn(git_gh_issue_read, 'issue_view_json')
const write = vi.spyOn(lane_ledger_write, 'record_split_filed')
const create = vi.spyOn(git_gh_exec, 'exec_gh_api')

function response(body = BODY, labels = [{ name: 'route:split' }], url = URL): string {
	return JSON.stringify({ number: CHILD, body, labels, url })
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	read.mockResolvedValue(response())
	write.mockResolvedValue()
	create.mockRejectedValue(new Error('Recovery must not create anything'))
})

afterEach(() => {
	write.mockReset()
})

afterAll(() => {
	vi.restoreAllMocks()
})

describe('split_child_recover_cli — recovery', () => {
	it('recovers the same child after the first append fails and clears its notice without comments', async () => {
		const unavailable = path.join(scratch, 'missing', LEDGER_NAME)

		await expect(
			original_write({ issue: Number(ORIGIN), child: URL }, unavailable),
		).rejects.toThrow()
		write.mockImplementation(async (entry) => {
			await original_write(entry, ledger_path)
		})
		const comments = vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue(undefined)

		expect(await split_child_recover_cli.run([ORIGIN, URL])).toBe(0)
		const entries = lane_ledger.read_entries(ledger_path)

		expect(entries).toMatchObject([{ issue: Number(ORIGIN), child: URL }])
		expect(split_resolution.split_issues([NOTICE, ...entries]).has(Number(ORIGIN))).toBe(true)
		expect(comments).not.toHaveBeenCalled()
		expect(create).not.toHaveBeenCalled()
	})

	it('recovers a cross-repository child with a qualified origin', async () => {
		const other_repo = 'joshuafolkken/app-kit'
		const other_url = `https://github.com/${other_repo}/issues/${String(CHILD)}`

		read.mockResolvedValue(response(`parent: ${REPO}#${ORIGIN}`, undefined, other_url))

		expect(await split_child_recover_cli.run([ORIGIN, other_url])).toBe(0)
		expect(read).toHaveBeenCalledWith(String(CHILD), 'number,body,labels,url', other_repo)
		expect(write).toHaveBeenCalledWith({ issue: Number(ORIGIN), child: other_url })
	})

	it('recovers a qualified parent from an origin repository containing a dot', async () => {
		const dotted_repo = 'owner/site.com'

		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValueOnce(dotted_repo)
		read.mockResolvedValue(response(`parent: ${dotted_repo}#${ORIGIN}`))

		expect(await split_child_recover_cli.run([ORIGIN, URL])).toBe(0)
		expect(write).toHaveBeenCalledWith({ issue: Number(ORIGIN), child: URL })
	})
})

describe('split_child_recover_cli — identities', () => {
	it('refuses a missing origin repository', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValueOnce(undefined)

		expect(await split_child_recover_cli.run([ORIGIN, URL])).toBe(1)
		expect(write).not.toHaveBeenCalled()
	})

	it('refuses the origin itself as a child', async () => {
		expect(await split_child_recover_cli.run([String(CHILD), URL])).toBe(1)
		expect(write).not.toHaveBeenCalled()
	})

	it('refuses a response naming a different issue', async () => {
		const different_url = `https://github.com/${REPO}/issues/1`

		read.mockResolvedValue(response(BODY, undefined, different_url))

		expect(await split_child_recover_cli.run([ORIGIN, URL])).toBe(1)
		expect(write).not.toHaveBeenCalled()
	})
})

describe('split_child_recover_cli — entry', () => {
	it('answers usage and exit code one through the guarded CLI entry without arguments', async () => {
		expect(await main_entry_fixture.run_entry('scripts/split/split-child-recover-cli.ts', [])).toBe(
			1,
		)
		expect(console.error).toHaveBeenCalledWith(
			'Usage: josh split:recover <origin> <child-issue-url>',
		)
	})
})

describe('split_child_recover_cli — refusals', () => {
	it.each([
		['another parent', response(OTHER_PARENT)],
		['another route', response(BODY, [{ name: 'route:tier-a' }])],
		['unreadable child', undefined],
		['malformed JSON', '{'],
		['a pull request', response(BODY, undefined, URL.replace('/issues/', '/pull/'))],
		['a parent in a fence', response(`\`\`\`\nparent: #${ORIGIN}\n\`\`\``)],
		['a quoted parent', response(`> parent: #${ORIGIN}`)],
		['a parent in another repository', response(`parent: someone/else#${ORIGIN}`)],
	])('refuses %s without recording evidence', async (_name, json) => {
		read.mockResolvedValue(json)

		expect(await split_child_recover_cli.run([ORIGIN, URL])).toBe(1)
		expect(lane_ledger_write.record_split_filed).not.toHaveBeenCalled()
	})

	it('keeps an append failure failed on recovery', async () => {
		vi.spyOn(lane_ledger_write, 'record_split_filed').mockRejectedValueOnce(new Error('unwritable'))

		expect(await split_child_recover_cli.run([ORIGIN, URL])).toBe(1)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unwritable'))
	})

	it.each([[[]], [[ORIGIN]], [[ORIGIN, URL, 'extra']], [['0', URL]], [[ORIGIN, '#6326']]])(
		'refuses invalid arguments %j',
		async (argv) => {
			expect(await split_child_recover_cli.run(argv)).toBe(1)
			expect(lane_ledger_write.record_split_filed).not.toHaveBeenCalled()
		},
	)
})
