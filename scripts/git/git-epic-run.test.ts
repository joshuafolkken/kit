import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_epic_parse } from './git-epic-parse'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		label_ensure: vi.fn(),
		issue_create_with_label: vi.fn(),
		issue_add_blocked_by: vi.fn(),
		issue_get_labels_and_body: vi.fn(),
		issue_edit_body: vi.fn(),
		issue_add_label: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const { git_epic_run, FAILURE_EXIT_CODE } = await import('./git-epic-run')

const mocked_label = vi.mocked(git_gh_command.label_ensure)
const mocked_create = vi.mocked(git_gh_command.issue_create_with_label)
const mocked_blocked_by = vi.mocked(git_gh_command.issue_add_blocked_by)
const mocked_view = vi.mocked(git_gh_command.issue_get_labels_and_body)

const EPIC_URL = 'https://github.com/joshuafolkken/kit/issues/700'
const CHILDREN = [101, 102, 103]
const RATIONALE = 'Split so each part merges on its own.'
const SUCCESS_EXIT_CODE = 0

function create_input(is_ordered: boolean): {
	title: string
	children: Array<number>
	rationale: string
	is_ordered: boolean
} {
	return { title: 'Epic: do the thing', children: CHILDREN, rationale: RATIONALE, is_ordered }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	vi.spyOn(console, 'error').mockImplementation(() => {
		/* suppress */
	})
	mocked_create.mockResolvedValue(EPIC_URL)
	mocked_blocked_by.mockResolvedValue(true)
})

describe('git_epic_run.create_epic', () => {
	it('ensures the epic label before creating the issue', async () => {
		await git_epic_run.create_epic(create_input(false))

		expect(mocked_label).toHaveBeenCalledWith(expect.objectContaining({ name: 'epic' }))
	})

	it('creates the issue carrying the epic label', async () => {
		await git_epic_run.create_epic(create_input(false))

		expect(mocked_create).toHaveBeenCalledWith(expect.objectContaining({ label: 'epic' }))
	})

	// The body has to be readable by the auto-close, which is the parser asserted here.
	it('creates a body whose children the auto-close can parse', async () => {
		await git_epic_run.create_epic(create_input(false))

		const body = mocked_create.mock.calls[0]?.[0].body ?? ''

		expect(git_epic_parse.parse_task_list_issue_numbers(body)).toStrictEqual(CHILDREN)
	})

	it('records no blocked-by relation for an unordered batch', async () => {
		await git_epic_run.create_epic(create_input(false))

		expect(mocked_blocked_by).not.toHaveBeenCalled()
	})

	it('prints the epicrun command naming the epic, not a list of children', async () => {
		await git_epic_run.create_epic(create_input(false))

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(expect.stringContaining('epicrun #700'))
	})
})

describe('git_epic_run.create_epic — declared order', () => {
	it('records a blocked-by relation per adjacent pair when ordered', async () => {
		await git_epic_run.create_epic(create_input(true))

		expect(mocked_blocked_by).toHaveBeenCalledTimes(2)
		expect(mocked_blocked_by).toHaveBeenCalledWith('102', '101')
		expect(mocked_blocked_by).toHaveBeenCalledWith('103', '102')
	})

	// gh < 2.94.0 cannot record the relation, and losing it costs only the native link — the epic
	// and its task list are already correct, so the run must not fail.
	it('succeeds when a relation cannot be recorded', async () => {
		mocked_blocked_by.mockResolvedValue(false)

		expect(await git_epic_run.create_epic(create_input(true))).toBe(SUCCESS_EXIT_CODE)
	})

	it('reports how many relations could not be recorded', async () => {
		mocked_blocked_by.mockResolvedValue(false)

		await git_epic_run.create_epic(create_input(true))

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			expect.stringContaining('2 of 2 blocked-by relation(s) could not be recorded'),
		)
	})
})

function view_json(input: { labels: Array<string>; body: string }): string {
	return JSON.stringify({
		number: 700,
		labels: input.labels.map((name) => ({ name })),
		body: input.body,
	})
}

const VALID_BODY =
	'## Dependencies\n\nNone — the children are independent; any execution order works.\n\n## Progress\n\n- [ ] #101\n- [ ] #102\n'

describe('git_epic_run.check_epic', () => {
	it('exits zero for an epic that satisfies every requirement', async () => {
		mocked_view.mockResolvedValue(view_json({ labels: ['epic'], body: VALID_BODY }))

		expect(await git_epic_run.check_epic(700)).toBe(SUCCESS_EXIT_CODE)
	})

	it('exits non-zero when the epic label is missing', async () => {
		mocked_view.mockResolvedValue(view_json({ labels: [], body: VALID_BODY }))

		expect(await git_epic_run.check_epic(700)).toBe(FAILURE_EXIT_CODE)
	})

	it('exits non-zero when the child list is not a task list', async () => {
		mocked_view.mockResolvedValue(view_json({ labels: ['epic'], body: '## Progress\n\n#101\n' }))

		expect(await git_epic_run.check_epic(700)).toBe(FAILURE_EXIT_CODE)
	})

	it('exits non-zero when the issue cannot be read', async () => {
		mocked_view.mockResolvedValue(undefined)

		expect(await git_epic_run.check_epic(700)).toBe(FAILURE_EXIT_CODE)
	})

	it('prints the per-requirement report', async () => {
		mocked_view.mockResolvedValue(view_json({ labels: ['epic'], body: VALID_BODY }))

		await git_epic_run.check_epic(700)

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(expect.stringContaining('epic label'))
	})
})
