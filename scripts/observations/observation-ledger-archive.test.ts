import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_gh_issue_alias_graphql } from '#scripts/gh/git-gh-issue-alias-graphql'
import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import { observation_ledger_archive } from './observation-ledger-archive'
import { observation_ledger_home } from './observation-ledger-home'

// joshuafolkken/kit#7336: a closed issue's ledger files move into the month it closed, and every
// reader of all history still counts the same lines.

const make_directory = temporary_directory('suite')
const TEST_DIR = make_directory('observation-ledger-archive-')
const CLOSED = 101
const LATER_CLOSED = 102
const OPEN = 103
const UNANSWERED = 104
const OCTOBER = '2026-10-31T23:00:00Z'
const NOVEMBER = '2026-11-02T00:00:00Z'
const OCTOBER_ARCHIVE = 'archive-2026-10.md'
const NOVEMBER_ARCHIVE = 'archive-2026-11.md'
const DATE_FILE = '2026-11-01.md'
const CLOSED_FILE = `${String(CLOSED)}.md`

function line_of(category: string, issue: number): string {
	return `- rf:${category} | low | a.ts:1 | 2026-10-14 | #${String(issue)}\n`
}

const FILES: Readonly<Record<string, string>> = {
	[`${String(CLOSED)}.md`]: line_of('tests', CLOSED),
	[`${String(CLOSED)}-comment-rounds.md`]: line_of('comments', CLOSED),
	[`${String(LATER_CLOSED)}.md`]: line_of('naming', LATER_CLOSED),
	[`${String(OPEN)}.md`]: line_of('tests', OPEN),
	[`${String(UNANSWERED)}-comment-rounds.md`]: line_of('assumptions', UNANSWERED),
	[DATE_FILE]: line_of('docs', OPEN),
}

const ANSWERS = new Map([
	[CLOSED, { state: 'CLOSED', closedAt: OCTOBER }],
	[LATER_CLOSED, { state: 'CLOSED', closedAt: NOVEMBER }],
	[OPEN, { state: 'OPEN', closedAt: undefined }],
])

const read_aliased = vi.spyOn(git_gh_issue_alias_graphql, 'read_aliased')

function ledger_root(name: string): string {
	const root = path.join(TEST_DIR, name)
	const directory = path.join(root, OBSERVATION_LEDGER_DIRECTORY)

	mkdirSync(directory, { recursive: true })

	for (const [file, content] of Object.entries(FILES)) {
		writeFileSync(path.join(directory, file), content)
	}

	return root
}

function ledger_file(root: string, name: string): string {
	return path.join(root, OBSERVATION_LEDGER_DIRECTORY, name)
}

async function finding_counts(root: string): Promise<string> {
	return JSON.stringify(
		review_finding_ledger.category_counts((await observation_ledger_home.read(root)) ?? ''),
	)
}

beforeEach(() => {
	read_aliased.mockReset().mockImplementation(async () => ({
		answers: ANSWERS,
		cost: 1,
		remaining: undefined,
	}))
})

describe('observation_ledger_archive.archive', () => {
	// Name order is `observation_ledger_home.read`'s, which puts `101-comment-rounds.md` before `101.md`.
	it('moves each closed issue’s files, in name order, into the month it closed', async () => {
		const root = ledger_root('moved')

		expect(await observation_ledger_archive.archive(root)).toBe(3)
		expect(readFileSync(ledger_file(root, OCTOBER_ARCHIVE), 'utf8')).toBe(
			`${line_of('comments', CLOSED)}${line_of('tests', CLOSED)}`,
		)
		expect(readFileSync(ledger_file(root, NOVEMBER_ARCHIVE), 'utf8')).toBe(
			line_of('naming', LATER_CLOSED),
		)
	})

	it('leaves an open issue’s file, an unanswered issue’s file and a date file where they are', async () => {
		const root = ledger_root('left')

		await observation_ledger_archive.archive(root)

		const left = readdirSync(path.join(root, OBSERVATION_LEDGER_DIRECTORY))

		expect(new Set(left)).toStrictEqual(
			new Set([
				`${String(OPEN)}.md`,
				`${String(UNANSWERED)}-comment-rounds.md`,
				DATE_FILE,
				OCTOBER_ARCHIVE,
				NOVEMBER_ARCHIVE,
				'archived-comment-rounds.txt',
			]),
		)
	})
})

describe('observation_ledger_archive.archive — what readers see', () => {
	it('leaves every reader of all history counting the same lines', async () => {
		const root = ledger_root('counted')
		const before = await finding_counts(root)

		await observation_ledger_archive.archive(root)

		expect(await finding_counts(root)).toBe(before)
	})

	it('appends to a month’s archive a later flush finds already there', async () => {
		const root = ledger_root('appended')

		writeFileSync(ledger_file(root, OCTOBER_ARCHIVE), line_of('docs', 1))
		await observation_ledger_archive.archive(root)

		expect(readFileSync(ledger_file(root, OCTOBER_ARCHIVE), 'utf8')).toMatch(/^- rf:docs .*#1\n/u)
	})
})

describe('observation_ledger_archive — the carried mark', () => {
	it('lists the issue of an archived rounds file only, so the carry never reads it again', async () => {
		const root = ledger_root('carried')

		await observation_ledger_archive.archive(root)

		expect([...observation_ledger_archive.archived_rounds(root)]).toStrictEqual([CLOSED])
	})

	it('answers no issue where nothing was archived', () => {
		expect(observation_ledger_archive.archived_rounds(ledger_root('none')).size).toBe(0)
	})
})

describe('observation_ledger_archive.archive_reported', () => {
	it('moves nothing and answers 0 when GitHub was not read, so the next flush retries', async () => {
		const root = ledger_root('unread')
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const failed_line = expect.stringContaining(observation_ledger_archive.ARCHIVE_FAILED_LINE)

		read_aliased.mockRejectedValueOnce(new Error('rate limited'))

		expect(await observation_ledger_archive.archive_reported(root)).toBe(0)
		expect(warn).toHaveBeenCalledWith(failed_line)
		expect(existsSync(ledger_file(root, CLOSED_FILE))).toBe(true)
	})

	it('answers 0 for a checkout that keeps no ledger', async () => {
		const absent = path.join(TEST_DIR, 'absent')

		expect(await observation_ledger_archive.archive_reported(absent)).toBe(0)
		expect(read_aliased).not.toHaveBeenCalled()
	})
})
