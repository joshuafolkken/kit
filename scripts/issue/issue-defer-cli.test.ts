import { acceptance_map } from '#scripts/review/acceptance-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_defer_cli } from './issue-defer-cli'

// joshuafolkken/kit#9146.

const { issue_get_body, issue_edit_body, get_repo_name_with_owner } = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue: string, repo?: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue: string, body: string, repo?: string) => Promise<string>>(),
	get_repo_name_with_owner: vi.fn<() => string | undefined>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body, issue_edit_body },
}))

vi.mock('#scripts/gh/gh-spawn', () => ({ gh_spawn: { get_repo_name_with_owner } }))

const ISSUE = '9103'
const TARGET = '9104'
const BODY = '## 受け入れ条件\n- [ ] First\n- [ ] Second criterion\n  wrapped onto a line\n'
const FIRST = acceptance_map.criterion_id('First')
const WRAPPED = acceptance_map.criterion_id('Second criterion wrapped onto a line')
const TARGET_BODY = '## 受け入れ条件\n- [ ] Rewritten'
const CROSS_REPO = 'other/repo'
const CROSS_NUMBER = '12'

function answer(bodies: Readonly<Record<string, string>>): void {
	issue_get_body.mockImplementation(async (issue) => bodies[issue])
}

function written(issue: string): string | undefined {
	return issue_edit_body.mock.calls.find(([edited]) => edited === issue)?.[1]
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	answer({ [ISSUE]: BODY, [TARGET]: TARGET_BODY })
	issue_edit_body.mockResolvedValue('https://github.com/o/r/issues/1')
	get_repo_name_with_owner.mockReturnValue('o/r')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_defer_cli.run', () => {
	it('marks the criterion → #M and keeps its identifier (ac-4ae478ae)', async () => {
		expect(await issue_defer_cli.run([ISSUE, FIRST, `#${TARGET}`, 'split', 'off'])).toBe(0)
		const issue_body = written(ISSUE) ?? ''

		expect(issue_body).toContain(`- [ ] First → #${TARGET}\n`)
		expect(acceptance_map.criteria_of(issue_body).map((criterion) => criterion.id)).toContain(FIRST)
	})

	it('marks a wrapped criterion on its last line', async () => {
		expect(await issue_defer_cli.run([ISSUE, WRAPPED, TARGET, 'later'])).toBe(0)

		expect(written(ISSUE)).toContain(`  wrapped onto a line → #${TARGET}\n`)
	})

	it('adds the reference line to a target that lacks the identifier', async () => {
		await issue_defer_cli.run([ISSUE, FIRST, `#${TARGET}`, 'split', 'off'])

		expect(written(TARGET)).toBe(`${TARGET_BODY}\n\n引き継ぎ: #${ISSUE} \`${FIRST}\` split off\n`)
	})

	it('leaves a target that already carries the identifier alone', async () => {
		answer({ [ISSUE]: BODY, [TARGET]: `- [ ] First (${FIRST})` })

		expect(await issue_defer_cli.run([ISSUE, FIRST, `#${TARGET}`, 'split'])).toBe(0)
		expect(written(TARGET)).toBeUndefined()
	})
})

describe('issue_defer_cli.run — a repository-qualified target', () => {
	it('treats a target naming this repository as an unqualified one', async () => {
		expect(await issue_defer_cli.run([ISSUE, FIRST, `o/r#${TARGET}`, 'r'])).toBe(0)

		expect(written(ISSUE)).toContain(`- [ ] First → #${TARGET}\n`)
		expect(issue_edit_body).toHaveBeenCalledWith(
			TARGET,
			`${TARGET_BODY}\n\n引き継ぎ: #${ISSUE} \`${FIRST}\` r\n`,
			undefined,
		)
	})

	it('defers to another repository, naming this one in the reference line', async () => {
		answer({ [ISSUE]: BODY, [CROSS_NUMBER]: TARGET_BODY })

		expect(await issue_defer_cli.run([ISSUE, FIRST, `${CROSS_REPO}#${CROSS_NUMBER}`, 'r'])).toBe(0)
		expect(written(ISSUE)).toContain(`- [ ] First → ${CROSS_REPO}#${CROSS_NUMBER}\n`)
		expect(issue_get_body).toHaveBeenCalledWith(CROSS_NUMBER, CROSS_REPO)
		expect(issue_edit_body).toHaveBeenCalledWith(
			CROSS_NUMBER,
			`${TARGET_BODY}\n\n引き継ぎ: o/r#${ISSUE} \`${FIRST}\` r\n`,
			CROSS_REPO,
		)
	})
})

describe('issue_defer_cli.run refusals', () => {
	it.each(
		[
			[],
			[ISSUE, FIRST, `#${TARGET}`],
			['0', FIRST, TARGET, 'r'],
			[ISSUE, FIRST, 'x', 'r'],
			[ISSUE, FIRST, `#${ISSUE}`, 'self'],
			[ISSUE, FIRST, `O/R#${ISSUE}`, 'self, this repository named'],
		].map((args) => ({ args })),
	)('refuses invalid arguments $args without reading GitHub', async ({ args }) => {
		expect(await issue_defer_cli.run(args)).toBe(1)
		expect(issue_get_body).not.toHaveBeenCalled()
	})

	it('refuses an unknown identifier before any write', async () => {
		expect(await issue_defer_cli.run([ISSUE, 'ac-stale', TARGET, 'r'])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('refuses a cross-repository target when this repository is unresolved, before any read', async () => {
		answer({ [ISSUE]: BODY, [CROSS_NUMBER]: TARGET_BODY })
		get_repo_name_with_owner.mockReturnValue(undefined)

		expect(await issue_defer_cli.run([ISSUE, FIRST, `${CROSS_REPO}#${CROSS_NUMBER}`, 'r'])).toBe(1)
		expect(issue_get_body).not.toHaveBeenCalled()
	})

	it('refuses an unreadable target without writing', async () => {
		answer({ [ISSUE]: BODY })

		expect(await issue_defer_cli.run([ISSUE, FIRST, TARGET, 'r'])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`#${TARGET}`))
	})
})
