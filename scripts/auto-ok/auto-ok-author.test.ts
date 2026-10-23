import type { EpicChild } from '#scripts/epic/epic-graph'
import type { AuthorFields } from '#scripts/gh/gh-author-association'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_author } from './auto-ok-author'
import { auto_ok_cli } from './auto-ok-cli'
import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	NEW_ISSUE_NUMBER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from './auto-ok-fixture'

// joshuafolkken/kit#4633: an unattended run takes an opted-in issue's body as its specification, and
// on a public repository anyone can file one — so only an issue whose author has write access is
// runnable, and a lookup that failed is not trust.

const api_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: api_mock } }))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_summary: vi.fn(), issue_list_by_label: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_summary)
const epic_list = vi.mocked(git_gh_command.issue_list_by_label)
const { issue, epic_listing, console_streams } = auto_ok_fixture
const streams = console_streams()

// A listing row as GitHub answers it: the author fields, and no trust assembled yet.
function filed_by(association: string, login: string, number = NEW_ISSUE_NUMBER): OpenIssueData {
	const row = { ...issue(number, CREATED_LATER), author_trusted: undefined }

	return { ...row, author_association: association, user: { login } }
}

async function trust_of(row: OpenIssueData): Promise<boolean | undefined> {
	const [read] = await auto_ok_author.with_author_trust([row])

	return read?.author_trusted
}

vi.spyOn(console, 'info').mockImplementation(streams.info)
vi.spyOn(console, 'error').mockImplementation(streams.error)

beforeEach(() => {
	vi.clearAllMocks()
	epic_list.mockResolvedValue(listing_outcome(epic_listing([])))
	streams.reset()
})

describe('auto_ok_author.with_author_trust', () => {
	it('trusts the owner without asking', async () => {
		await expect(trust_of(filed_by('OWNER', 'owner'))).resolves.toBe(true)
		expect(api_mock).not.toHaveBeenCalled()
	})

	it('does not trust an author outside the repository', async () => {
		await expect(trust_of(filed_by('NONE', 'stranger'))).resolves.toBe(false)
	})

	it('does not trust a MEMBER without write access', async () => {
		api_mock.mockResolvedValue(JSON.stringify({ permission: 'read', role_name: 'triage' }))

		await expect(trust_of(filed_by('MEMBER', 'reader'))).resolves.toBe(false)
	})

	it('does not take a failed lookup as trust', async () => {
		api_mock.mockRejectedValue(new Error('timed out'))

		await expect(trust_of(filed_by('MEMBER', 'unreachable'))).resolves.toBe(false)
	})
})

describe('auto_ok_author.is_author_trusted', () => {
	it('refuses a row whose trust was never assembled', () => {
		const row = { ...issue(NEW_ISSUE_NUMBER, CREATED_LATER), author_trusted: undefined }

		expect(auto_ok_author.is_author_trusted(row)).toBe(false)
	})
})

const CHILD_REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'

// The author fields a child's read carried.
function author(association: string, login: string): AuthorFields {
	return { author_association: association, user: { login } }
}

// An epic child as the graph holds it.
function child(number: number, fields: AuthorFields, repo = CHILD_REPO): EpicChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [], ...fields }
}

async function untrusted_keys(children: ReadonlyArray<EpicChild>): Promise<Array<string>> {
	return [...(await auto_ok_author.untrusted_child_keys(children, CHILD_REPO))]
}

describe('auto_ok_author.untrusted_child_keys — a child in this repository', () => {
	it('names a child filed outside the repository, not one the owner filed', async () => {
		const children = [
			child(NEW_ISSUE_NUMBER, author('NONE', 'outsider')),
			child(OLD_ISSUE_NUMBER, author('OWNER', 'owner')),
		]

		await expect(untrusted_keys(children)).resolves.toEqual([
			`${CHILD_REPO}#${String(NEW_ISSUE_NUMBER)}`,
		])
	})

	it('trusts a MEMBER child once the lookup answers a write role', async () => {
		api_mock.mockResolvedValue(JSON.stringify({ permission: 'write', role_name: 'write' }))

		const member = child(NEW_ISSUE_NUMBER, author('MEMBER', 'writer'))

		await expect(untrusted_keys([member])).resolves.toEqual([])
	})

	it('names a child read without author fields', async () => {
		await expect(untrusted_keys([child(NEW_ISSUE_NUMBER, {})])).resolves.toHaveLength(1)
	})
})

describe('auto_ok_author.untrusted_child_keys — a child in another repository', () => {
	// This repository's collaborator list says nothing about access to another repository.
	it('trusts it only as OWNER, asking nothing', async () => {
		const children = [
			child(NEW_ISSUE_NUMBER, author('COLLABORATOR', 'elsewhere'), OTHER_REPO),
			child(OLD_ISSUE_NUMBER, author('OWNER', 'owner'), OTHER_REPO),
		]

		await expect(untrusted_keys(children)).resolves.toEqual([
			`${OTHER_REPO}#${String(NEW_ISSUE_NUMBER)}`,
		])
		expect(api_mock).not.toHaveBeenCalled()
	})
})

describe('josh auto-ok:next — an issue whose author lacks write access', () => {
	it('does not answer it', async () => {
		const listing = JSON.stringify([filed_by('NONE', 'outsider')])

		issue_list.mockResolvedValueOnce(listing_outcome(listing))

		expect(await auto_ok_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(streams.stdout()).toBe(auto_ok_cli.NONE_TOKEN)
		expect(streams.stderr()).toContain('author without write access (waiting on a person)')
	})

	it('skips past it to an older issue the owner filed', () => {
		const untrusted = { ...issue(NEW_ISSUE_NUMBER, CREATED_LATER), author_trusted: false }
		const issues = [untrusted, issue(OLD_ISSUE_NUMBER, CREATED_EARLIER)]

		expect(auto_ok_cli.pick_next(issues)?.number).toBe(OLD_ISSUE_NUMBER)
	})
})
