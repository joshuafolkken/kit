import { line_budget, type FileBudget } from '#scripts/lines/line-budget'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_cap_files } from './issue-cap-files'

// joshuafolkken/kit#7184: a body naming a file at or past 90% of its code-line limit is steered to a
// refactor Issue first, unless it declares it adds no lines; a smaller file changes nothing.

const ROOT = process.cwd()
const NAMED = 'scripts/issue/size-estimate.ts'
const LIMIT = 300
const AT_CAP = 270
const UNDER_CAP = 269
const BLOCKED_BY = '--blocked-by'

function budget_at(code_lines: number): FileBudget {
	return {
		file_path: NAMED,
		limit: LIMIT,
		budget: line_budget.budget_of(code_lines, LIMIT),
	}
}

function body_of(...background: ReadonlyArray<string>): string {
	return ['## 背景', '', ...background, `\`${NAMED}\` に行を足す`, '', '## 現象', '', 'x'].join(
		'\n',
	)
}

async function problem_of(body: string): Promise<string | undefined> {
	return issue_cap_files.problem(await issue_cap_files.near_cap(body, ROOT))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_cap_files — a named file near its cap', () => {
	it('refuses a body naming a file at 270 of 300 code lines and routes to a refactor first', async () => {
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([budget_at(AT_CAP)])

		const problem = await problem_of(body_of())

		expect(problem).toContain(NAMED)
		expect(problem).toContain('prompts/refactoring.md')
		expect(problem).toContain(BLOCKED_BY)
		expect(problem).toContain(issue_cap_files.NO_LINES_PREFIX)
	})

	it('passes the same body when it declares it adds no lines', async () => {
		const counted = vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([budget_at(AT_CAP)])

		const problem = await problem_of(
			body_of(`${issue_cap_files.NO_LINES_PREFIX} 呼び出しを差し替えるだけ`),
		)

		expect(problem).toBeUndefined()
		expect(counted).not.toHaveBeenCalled()
	})

	it('passes the refile that declares the refactor Issue it waits on', async () => {
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([budget_at(AT_CAP)])
		const refused = await problem_of(body_of())

		const problem = await problem_of(body_of(`${issue_cap_files.REFACTOR_PREFIX} #7200`))

		expect(refused).toContain(`${issue_cap_files.REFACTOR_PREFIX} #<refactor>`)
		expect(problem).toBeUndefined()
	})

	it('still refuses a refactor declaration that cites no Issue', async () => {
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([budget_at(AT_CAP)])

		const problem = await problem_of(body_of(`${issue_cap_files.REFACTOR_PREFIX} あとで`))

		expect(problem).toContain(NAMED)
	})

	it('passes a body whose named files are under 270 code lines', async () => {
		vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([budget_at(UNDER_CAP)])

		expect(await problem_of(body_of())).toBeUndefined()
	})
})

describe('issue_cap_files — what is counted', () => {
	it('runs no count when the body names no existing lintable file', async () => {
		const counted = vi.spyOn(line_budget, 'budgets_for')
		const body = '## 背景\n\n`scripts/missing/nowhere.ts` と `docs/josh-commands-backlog.md`\n'

		expect(await issue_cap_files.near_cap(body, ROOT)).toEqual([])
		expect(counted).not.toHaveBeenCalled()
	})

	it('weighs every extension ESLint lints and skips the rest', async () => {
		const counted = vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
		const body = '## 背景\n\n`eslint.config.js` `vitest.config.ts` `README.md` `package.json`\n'

		await issue_cap_files.near_cap(body, ROOT)

		expect(counted).toHaveBeenCalledWith(['eslint.config.js', 'vitest.config.ts'], ROOT)
	})

	it('counts every named file, past the run:prep locate cap', async () => {
		const counted = vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
		const fillers = Array.from({ length: 10 }, (_, index) => `\`name-${String(index)}.x\``)
		const body = ['## 背景', '', ...fillers, `\`${NAMED}\``].join('\n')

		await issue_cap_files.near_cap(body, ROOT)

		expect(counted).toHaveBeenCalledWith([NAMED], ROOT)
	})

	it('counts every body in one run and answers each its own files', async () => {
		const counted = vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([budget_at(AT_CAP)])
		const bodies = [body_of(), '## 背景\n\nx\n', body_of()]

		const near = await issue_cap_files.near_cap_by_body(bodies, ROOT)

		expect(counted).toHaveBeenCalledTimes(1)
		expect(near.map((entry) => entry.length)).toEqual([1, 0, 1])
	})

	it('warns at offer time with the declaration it lacks', () => {
		const note = issue_cap_files.note([budget_at(AT_CAP)])

		expect(note).toContain('270/300 code lines')
		expect(note).toContain(`no \`${issue_cap_files.NO_LINES_PREFIX}\``)
	})
})
