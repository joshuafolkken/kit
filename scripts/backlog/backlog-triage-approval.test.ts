import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { IssueComment } from '#scripts/issue/issue-read'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const root_mock = vi.hoisted(() => vi.fn(async (): Promise<string> => ''))
const comment_mock = vi.hoisted(() => vi.fn(async (): Promise<string> => ''))

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { main_repository_root: root_mock },
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_comment: comment_mock },
}))

const { backlog_triage_approval } = await import('./backlog-triage-approval')
const { lane_plan_approval } = await import('#scripts/lane/lane-plan-approval')

// joshuafolkken/kit#6776: adopting a size-approval park option writes the trusted approval comment
// and the `--size-approval` json `lane-plan-approval.ts` reads, both axes, in the main checkout.

const ISSUE = '6776'
const NEW_URL = 'https://github.com/o/r/issues/6776#issuecomment-2'
const OLD_URL = 'https://github.com/o/r/issues/6776#issuecomment-1'
const RANGE = {
	paths: ['scripts/a.ts', 'docs/b.md'],
	lines: { declared: 150, max: 260 },
	files: { declared: 4, max: 6 },
}

const REASON = 'one --adopt path'
const root = temporary_directory('suite')('triage-approval-')

beforeEach(() => {
	root_mock.mockResolvedValue(root)
	comment_mock.mockReset()
	comment_mock.mockResolvedValue(NEW_URL)
})

afterEach(() => {
	rmSync(path.join(root, '.josh'), { recursive: true, force: true })
})

function comment(body: string, is_trusted: boolean): IssueComment {
	return { html_url: OLD_URL, author: 'owner', created_at: '2026-11-09', body, is_trusted }
}

async function write(comments: ReadonlyArray<IssueComment> = []): Promise<unknown> {
	const file = await backlog_triage_approval.write({
		issue: ISSUE,
		reason: REASON,
		range: RANGE,
		comments,
	})

	return JSON.parse(readFileSync(file, 'utf8'))
}

function posted_body(): string {
	const [call] = comment_mock.mock.calls as unknown as ReadonlyArray<[string, string]>

	return call?.[1] ?? ''
}

describe('backlog_triage_approval.write', () => {
	it('writes the approval comment, then a json citing it that the lane:plan reader accepts (ac-65c53234)', async () => {
		const json = await write()

		expect(comment_mock).toHaveBeenCalledOnce()
		expect(posted_body()).toContain('- declared_lines: 150 / max_lines: 260')
		expect(json).toStrictEqual({
			issue: 6776,
			paths: RANGE.paths,
			source: NEW_URL,
			rationale: REASON,
			declared_lines: 150,
			max_lines: 260,
			declared_files: 4,
			max_files: 6,
		})
		expect(
			lane_plan_approval.approval_schema.safeParse({ ...(json as object), author: 'o', body: '' })
				.success,
		).toBe(true)
	})
})

describe('backlog_triage_approval.write on a re-run', () => {
	it('reuses a trusted comment already stating the range instead of writing a second (ac-a9f8a8d0)', async () => {
		await write()
		const posted = comment(`${posted_body()}\n\n<!-- josh:run -->`, true)

		comment_mock.mockClear()

		expect(await write([posted])).toMatchObject({ source: OLD_URL })
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('does not reuse a comment whose last bound only shares a prefix with the range', async () => {
		await write()
		const wider = comment(posted_body().replace('max_lines: 260', 'max_lines: 2600'), true)

		comment_mock.mockClear()

		expect(await write([wider])).toMatchObject({ source: NEW_URL })
		expect(comment_mock).toHaveBeenCalledOnce()
	})

	it('does not take an untrusted comment as the approval', async () => {
		await write()
		const forged = comment(posted_body(), false)

		comment_mock.mockClear()

		expect(await write([forged])).toMatchObject({ source: NEW_URL })
		expect(comment_mock).toHaveBeenCalledOnce()
	})
})

describe('backlog_triage_approval.existing_file', () => {
	it('names the json once written, and nothing before', async () => {
		expect(await backlog_triage_approval.existing_file(ISSUE)).toBeUndefined()
		await write()

		expect(await backlog_triage_approval.existing_file(ISSUE)).toBe(
			path.join(root, '.josh/tmp/size-approval-6776.json'),
		)
	})
})
