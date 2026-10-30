import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_code_scanning } from './git-gh-code-scanning'
import { git_gh_exec } from './git-gh-exec'

// joshuafolkken/kit#5381: an open code scanning alert in the pull request's own files names its rule
// and `file:line`; every gap in reading it answers none, so the ship merges again as before.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const PR_NUMBER = 5282
const OWN_FILE = 'scripts/lib/strip.ts'
const OTHER_FILE = 'scripts/hooks/run-hook-worktree.test.ts'
const OWN_LINE = 12
const OTHER_LINE = 55
const RULE = 'js/incomplete-multi-character-sanitization'
const OTHER_RULE = 'js/shell-command-injection-from-environment'
const FILES = [{ filename: OWN_FILE }]

function alert(rule: string, path: string, start_line: number): unknown {
	return { rule: { id: rule }, most_recent_instance: { location: { path, start_line } } }
}

function answer(alerts: unknown, files: unknown = FILES): void {
	mocked_api.mockImplementation(async ({ path }) =>
		JSON.stringify(path.includes('code-scanning') ? alerts : files),
	)
}

beforeEach(() => {
	mocked_api.mockReset()
})

describe('git_gh_code_scanning.own_alerts_note — an alert in the pull request’s own files', () => {
	it('names the rule and the file:line of each alert in a changed file', async () => {
		answer([alert(RULE, OWN_FILE, OWN_LINE), alert(OTHER_RULE, OTHER_FILE, OTHER_LINE)])

		expect(await git_gh_code_scanning.own_alerts_note(PR_NUMBER)).toBe(
			`${git_gh_code_scanning.ALERT_NOTE}\n  ${RULE} — ${OWN_FILE}:${String(OWN_LINE)}`,
		)
	})

	it('asks for the open alerts of this pull request and its changed files', async () => {
		answer([])

		await git_gh_code_scanning.own_alerts_note(PR_NUMBER)

		const paths = mocked_api.mock.calls.map(([request]) => request.path)

		expect(paths).toStrictEqual([
			expect.stringMatching(/code-scanning\/alerts\?.*state=open&ref=refs\/pull\/5282\/merge$/u),
			expect.stringMatching(/pulls\/5282\/files\?per_page=100$/u),
		])
	})
})

describe('git_gh_code_scanning.own_alerts_note — nothing to stop on', () => {
	it('answers none when every alert sits outside the changed files', async () => {
		answer([alert(OTHER_RULE, OTHER_FILE, OTHER_LINE)])

		expect(await git_gh_code_scanning.own_alerts_note(PR_NUMBER)).toBeUndefined()
	})

	it.each([
		['an alert with no location', [{ rule: { id: RULE }, most_recent_instance: {} }], FILES],
		['an alert listing that is not one', { message: 'Forbidden' }, FILES],
		['a file listing that is not one', [alert(RULE, OWN_FILE, OWN_LINE)], { message: 'x' }],
	])('answers none on %s', async (_label, alerts, files) => {
		answer(alerts, files)

		expect(await git_gh_code_scanning.own_alerts_note(PR_NUMBER)).toBeUndefined()
	})

	it('answers none when the endpoint refuses', async () => {
		mocked_api.mockRejectedValue(new Error('HTTP 403'))

		expect(await git_gh_code_scanning.own_alerts_note(PR_NUMBER)).toBeUndefined()
	})
})
