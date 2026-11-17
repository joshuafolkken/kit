import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLAN_UNVERIFIED_LABEL } from './issue-labels'
import { issue_plan_target } from './issue-plan-target'

// joshuafolkken/kit#7733: a plan whose `--repo` is not the working checkout's repository is held as
// `plan:unverified`. The checkout's repository and the label writes are mocked.

type LabelWrite = (issue_number: string, label: string, repo?: string) => Promise<boolean>

const { get_repo_name_with_owner, issue_add_label, issue_clear_label } = vi.hoisted(() => ({
	get_repo_name_with_owner: vi.fn<() => string | undefined>(),
	issue_add_label: vi.fn<LabelWrite>(),
	issue_clear_label: vi.fn<LabelWrite>(),
}))

vi.mock('#scripts/gh/gh-spawn', () => ({ gh_spawn: { get_repo_name_with_owner } }))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_add_label, issue_clear_label },
}))

const TARGET = 'joshuafolkken/kit'
const printed: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	printed.length = 0
	errors.length = 0
	get_repo_name_with_owner.mockReturnValue(TARGET)
	issue_add_label.mockResolvedValue(true)
	issue_clear_label.mockResolvedValue(true)
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

describe('issue_plan_target.foreign_of — a --repo other than the working checkout', () => {
	it.each([
		{ name: 'no --repo', repo: undefined, checkout: TARGET, expected: undefined },
		{ name: 'the same repository', repo: TARGET, checkout: TARGET, expected: undefined },
		{ name: 'another casing', repo: 'JoshuaFolkken/Kit', checkout: TARGET, expected: undefined },
		{
			name: 'another repository',
			repo: TARGET,
			checkout: 'joshuafolkken/app-kit',
			expected: TARGET,
		},
		{ name: 'an unreadable checkout', repo: TARGET, checkout: undefined, expected: TARGET },
	])('answers $expected for $name', ({ repo, checkout, expected }) => {
		get_repo_name_with_owner.mockReturnValue(checkout)

		expect(issue_plan_target.foreign_of(repo)).toBe(expected)
	})
})

describe('issue_plan_target.mark_unverified — the label and the re-plan command', () => {
	it('labels plan:unverified on the target and prints the re-plan', async () => {
		expect(await issue_plan_target.mark_unverified('7', TARGET)).toBe(true)

		expect(issue_add_label).toHaveBeenCalledWith('7', PLAN_UNVERIFIED_LABEL, TARGET)
		expect(printed.join('\n')).toContain(
			`Re-plan from a ${TARGET} checkout: pnpm josh issue:plan 7 --body-file <plan> --planned`,
		)
	})

	it('reports a label it could not apply', async () => {
		issue_add_label.mockResolvedValue(false)

		expect(await issue_plan_target.mark_unverified('7', TARGET)).toBe(false)
		expect(errors.join('\n')).toContain(PLAN_UNVERIFIED_LABEL)
	})
})

describe('issue_plan_target.clear_unverified — a re-plan from the target', () => {
	it('clears plan:unverified on the addressed repository', async () => {
		await issue_plan_target.clear_unverified('7', TARGET)

		expect(issue_clear_label).toHaveBeenCalledWith('7', PLAN_UNVERIFIED_LABEL, TARGET)
	})
})
