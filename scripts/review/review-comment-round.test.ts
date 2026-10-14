import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_comment_round } from './review-comment-round'
import { review_finding_ledger } from './review-finding-ledger'

// joshuafolkken/kit#3811: a round recorded on the issue after its pull request opened reaches the
// ledger's readers once the issue is closed — the next round recorded carries it into the ledger.

const repo_mock = vi.hoisted(() => vi.fn())
const api_mock = vi.hoisted(() => vi.fn())
const comments_mock = vi.hoisted(() => vi.fn())

// The repository is named from the work tree's `origin`, so naming it never spawns `gh`.
vi.mock('#scripts/issue/session-cite', async (original) => {
	const actual = await original<{ session_cite: typeof session_cite }>()

	return { session_cite: { ...actual.session_cite, session_repo: repo_mock } }
})
vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: api_mock } }))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: comments_mock },
}))

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-comment-round-'))
const ISSUE = 3769
const ROUND = [
	'- rf:assumptions | low | scripts/run/board/run-board-usual.ts:17 | 2026-10-14 | #3769',
	'- rf:comments | low | docs/josh-commands-run.md:458 | 2026-10-14 | #3769',
]
const OWNER = 'OWNER'
const QUOTING = `See ${review_comment_round.body_of(['- rf:tests | low | a.ts | 2026-10-14 | #3769'])}`

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

beforeEach(() => {
	repo_mock.mockReset().mockReturnValue('joshuafolkken/kit')
	api_mock.mockReset().mockResolvedValue(JSON.stringify({ items: [{ number: ISSUE }] }))
	comments_mock.mockReset().mockResolvedValue(
		JSON.stringify([
			{ body: 'plan', author_association: OWNER },
			{ body: review_comment_round.body_of(ROUND), author_association: OWNER },
			{ body: QUOTING, author_association: OWNER },
		]),
	)
})

function root_of(name: string): string {
	return path.join(TEST_DIR, name)
}

describe('review_comment_round.lines_of', () => {
	it('reads the ledger lines of a comment round and none of any other comment', () => {
		const comments = [
			{ body: 'plan', author_association: OWNER },
			{ body: review_comment_round.body_of(ROUND), author_association: OWNER },
			{ author_association: OWNER },
		]

		expect(review_comment_round.lines_of(comments)).toStrictEqual(ROUND)
	})

	it('reads nothing from a comment that only quotes a round', () => {
		expect(
			review_comment_round.lines_of([{ body: QUOTING, author_association: OWNER }]),
		).toStrictEqual([])
	})

	it.each(['NONE', 'CONTRIBUTOR', undefined])(
		'reads nothing from a round posted by an author without write access (%s)',
		(author_association) => {
			const comment = { body: review_comment_round.body_of(ROUND), author_association }

			expect(review_comment_round.lines_of([comment])).toStrictEqual([])
		},
	)
})

describe('review_comment_round.carry', () => {
	it('carries a closed issue’s comment round into the ledger, where its readers count it', async () => {
		const root = root_of('carried')

		expect(await review_comment_round.carry(root)).toBe(ROUND.length)

		const counts = review_finding_ledger.category_counts(
			(await observation_ledger_home.read(root)) ?? '',
		)

		expect(
			counts.map((count) => count.category).toSorted((left, right) => left.localeCompare(right)),
		).toStrictEqual(['assumptions', 'comments'])
	})

	it('searches the repository’s closed issues for a comment round', async () => {
		await review_comment_round.carry(root_of('query'))

		const { path: request } = api_mock.mock.calls[0]?.[0] as { path: string }
		const query = new URLSearchParams(request.split('?', 2)[1]).get('q')

		expect(query).toContain('repo:joshuafolkken/kit is:issue is:closed in:comments')
	})
})

describe('review_comment_round.carry — what it leaves', () => {
	it('reads an issue already carried no more', async () => {
		const root = root_of('again')

		await review_comment_round.carry(root)
		comments_mock.mockClear()

		expect(await review_comment_round.carry(root)).toBe(0)
		expect(comments_mock).not.toHaveBeenCalled()
		expect(readFileSync(review_comment_round.carried_path(ISSUE, root), 'utf8')).toBe(
			`${ROUND.join('\n')}\n`,
		)
	})

	it('writes no file where the comments could not be read, so the next run reads them again', async () => {
		const root = root_of('unread')

		comments_mock.mockResolvedValue(undefined)

		await expect(review_comment_round.carry(root)).rejects.toThrow(`#${String(ISSUE)}`)
		expect(existsSync(review_comment_round.carried_path(ISSUE, root))).toBe(false)
	})

	it('throws, reading no search, where the repository could not be named', async () => {
		repo_mock.mockReturnValue(undefined)

		await expect(review_comment_round.carry(root_of('no-repo'))).rejects.toThrow('repository')
		expect(api_mock).not.toHaveBeenCalled()
	})

	it('throws where the search for closed issues could not be read', async () => {
		api_mock.mockResolvedValue('')

		await expect(review_comment_round.carry(root_of('no-search'))).rejects.toThrow('search')
	})
})
