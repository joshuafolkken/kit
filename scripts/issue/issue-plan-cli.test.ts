import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANNED_LABEL } from './issue-labels'
import { issue_plan_cli } from './issue-plan-cli'
import { plan_consumers_section } from './plan-consumers-section'

// joshuafolkken/kit#4134: the title, the plan and `run:planned` in one call. The `gh` surface is mocked
// so each write the command would make is read back without touching GitHub.

// Each write takes the issue, its text and the optional `--repo` it was addressed to.
type IssueWrite<T> = (issue_number: string, text: string, repo?: string) => Promise<T>

const { issue_view_json, issue_edit_body, issue_edit_title, issue_comment, issue_add_label } =
	vi.hoisted(() => ({
		issue_view_json:
			vi.fn<(issue_number: string, fields: string, repo?: string) => Promise<string | undefined>>(),
		issue_edit_body: vi.fn<IssueWrite<string>>(),
		issue_edit_title: vi.fn<IssueWrite<string>>(),
		issue_comment: vi.fn<IssueWrite<string>>(),
		issue_add_label: vi.fn<IssueWrite<boolean>>(),
	}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_view_json,
		issue_edit_body,
		issue_edit_title,
		issue_comment,
		issue_add_label,
	},
}))

const ISSUE_URL = 'https://github.com/o/r/issues/7'
const COMMENT_URL = 'https://github.com/o/r/issues/7#issuecomment-1'
const CONSUMERS_SECTION = `${plan_consumers_section.HEADING}\n- なし（the plan adds no concept）\n`
const PLAN = `## Plan\n- step one\n\n${CONSUMERS_SECTION}`
const PLAN_WITHOUT_CONSUMERS = '## Plan\n- step one\n'
const TITLE = 'Add issue:plan'
const OTHER_REPO = 'joshuafolkken/kit'
const BODY_FILE_FLAG = '--body-file'
const TITLE_FLAG = '--title'
const PLANNED_FLAG = '--planned'
const FILLED_BODY = '## Background'

// The issue read `issue_body_or_comment` makes: the body, filed by the owner.
function body_json(body: string): string {
	return JSON.stringify({ body, author_association: 'OWNER' })
}

const work = mkdtempSync(path.join(tmpdir(), 'issue-plan-cli-'))
const PLAN_FILE = path.join(work, 'plan.md')
const EMPTY_FILE = path.join(work, 'empty.md')
const NO_CONSUMERS_FILE = path.join(work, 'no-consumers.md')

writeFileSync(PLAN_FILE, PLAN)
writeFileSync(EMPTY_FILE, '  \n')
writeFileSync(NO_CONSUMERS_FILE, PLAN_WITHOUT_CONSUMERS)

const printed: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	printed.length = 0
	errors.length = 0
	vi.clearAllMocks()
	issue_view_json.mockResolvedValue(body_json(''))
	issue_edit_body.mockResolvedValue(ISSUE_URL)
	issue_edit_title.mockResolvedValue(ISSUE_URL)
	issue_comment.mockResolvedValue(COMMENT_URL)
	issue_add_label.mockResolvedValue(true)
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		printed.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		errors.push(String(line))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe('issue_plan_cli.run — the plan goes to a blank body, else a comment', () => {
	it('writes the plan into a blank body', async () => {
		const code = await issue_plan_cli.run(['7', BODY_FILE_FLAG, PLAN_FILE])

		expect(code).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledWith('7', PLAN, undefined)
		expect(issue_comment).not.toHaveBeenCalled()
		expect(printed).toContain(`body: ${ISSUE_URL}`)
	})

	it('posts the plan as a comment when the body has content', async () => {
		issue_view_json.mockResolvedValue(body_json(FILLED_BODY))

		const code = await issue_plan_cli.run(['7', BODY_FILE_FLAG, PLAN_FILE])

		expect(code).toBe(0)
		expect(issue_comment).toHaveBeenCalledWith('7', PLAN, undefined)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(printed).toContain(`comment: ${COMMENT_URL}`)
	})
})

describe('issue_plan_cli.run — --title and --planned act only when given', () => {
	it('touches neither the title nor the labels without the flags', async () => {
		await issue_plan_cli.run(['7', BODY_FILE_FLAG, PLAN_FILE])

		expect(issue_edit_title).not.toHaveBeenCalled()
		expect(issue_add_label).not.toHaveBeenCalled()
	})

	it('renames the issue on --title and labels it on --planned', async () => {
		const code = await issue_plan_cli.run([
			'7',
			BODY_FILE_FLAG,
			PLAN_FILE,
			TITLE_FLAG,
			` ${TITLE} `,
			PLANNED_FLAG,
		])

		expect(code).toBe(0)
		expect(issue_edit_title).toHaveBeenCalledWith('7', TITLE, undefined)
		expect(issue_add_label).toHaveBeenCalledWith('7', PLANNED_LABEL, undefined)
	})

	it('fails when run:planned could not be applied', async () => {
		issue_add_label.mockResolvedValue(false)

		const code = await issue_plan_cli.run(['7', BODY_FILE_FLAG, PLAN_FILE, PLANNED_FLAG])

		expect(code).toBe(1)
		expect(errors.join('\n')).toContain(PLANNED_LABEL)
	})
})

describe('issue_plan_cli.run — the title goes first and the label last', () => {
	it('renames first and never labels an issue whose plan failed to post', async () => {
		issue_view_json.mockResolvedValue(body_json(FILLED_BODY))
		const refusal = 'comment refused'

		issue_comment.mockRejectedValue(new Error(refusal))

		const code = await issue_plan_cli.run([
			'7',
			BODY_FILE_FLAG,
			PLAN_FILE,
			TITLE_FLAG,
			TITLE,
			PLANNED_FLAG,
		])

		expect(code).toBe(1)
		expect(errors).toContain(refusal)
		expect(issue_edit_title).toHaveBeenCalledWith('7', TITLE, undefined)
		expect(issue_add_label).not.toHaveBeenCalled()
	})
})

describe('issue_plan_cli.run — --repo addresses every write to the named repository', () => {
	it('passes the repository to the title, the plan and the label', async () => {
		issue_view_json.mockResolvedValue(body_json(FILLED_BODY))

		const code = await issue_plan_cli.run([
			'7',
			BODY_FILE_FLAG,
			PLAN_FILE,
			TITLE_FLAG,
			TITLE,
			PLANNED_FLAG,
			'--repo',
			OTHER_REPO,
		])

		expect(code).toBe(0)
		expect(issue_edit_title).toHaveBeenCalledWith('7', TITLE, OTHER_REPO)
		expect(issue_view_json).toHaveBeenCalledWith('7', expect.any(String), OTHER_REPO)
		expect(issue_comment).toHaveBeenCalledWith('7', PLAN, OTHER_REPO)
		expect(issue_add_label).toHaveBeenCalledWith('7', PLANNED_LABEL, OTHER_REPO)
	})
})

describe('issue_plan_cli.run — refuses a call it cannot record', () => {
	it.each([
		{ name: 'no issue number', argv: [BODY_FILE_FLAG, PLAN_FILE] },
		{ name: 'no --body-file', argv: ['7'] },
		{ name: 'an empty plan', argv: ['7', BODY_FILE_FLAG, EMPTY_FILE] },
		{ name: 'a blank --title', argv: ['7', BODY_FILE_FLAG, PLAN_FILE, TITLE_FLAG, ' '] },
		{ name: 'a blank --repo', argv: ['7', BODY_FILE_FLAG, PLAN_FILE, '--repo', ' '] },
		{ name: 'an unknown flag', argv: ['7', BODY_FILE_FLAG, PLAN_FILE, '--body', 'x'] },
	])('refuses $name with the usage line', async ({ argv }) => {
		const code = await issue_plan_cli.run(argv)

		expect(code).toBe(1)
		expect(errors).toContain(issue_plan_cli.USAGE)
		expect(issue_view_json).not.toHaveBeenCalled()
	})

	it('refuses a plan without the existing-consumers section before any write', async () => {
		const code = await issue_plan_cli.run(['7', BODY_FILE_FLAG, NO_CONSUMERS_FILE, PLANNED_FLAG])

		expect(code).toBe(1)
		expect(errors.join('\n')).toContain(plan_consumers_section.HEADING)
		expect(issue_view_json).not.toHaveBeenCalled()
		expect(issue_add_label).not.toHaveBeenCalled()
	})

	it('names the resolved path when the plan file is missing', async () => {
		const code = await issue_plan_cli.run(['7', BODY_FILE_FLAG, path.join(work, 'absent.md')])

		expect(code).toBe(1)
		expect(errors.join('\n')).toContain('absent.md')
	})
})
