import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const classified_mock = vi.hoisted(() => vi.fn())
const edit_body_mock = vi.hoisted(() => vi.fn())
const file_issue_mock = vi.hoisted(() => vi.fn())
const fetch_epics_mock = vi.hoisted(() => vi.fn())
const build_epic_index_mock = vi.hoisted(() => vi.fn())
const add_children_mock = vi.hoisted(() => vi.fn())
const create_epic_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_view_json_classified: classified_mock,
		issue_edit_body: edit_body_mock,
	},
}))
vi.mock('./issue-file-cli', () => ({ issue_file_cli: { file_issue: file_issue_mock } }))
vi.mock('#scripts/epic/epic-index', () => ({
	epic_index: { fetch_epics: fetch_epics_mock, build_epic_index: build_epic_index_mock },
}))
vi.mock('#scripts/epic/epic-add', () => ({ epic_add: { add_children: add_children_mock } }))
vi.mock('#scripts/epic/epic-run', () => ({
	epic_run: { create_epic_number: create_epic_mock },
}))

const { issue_spill_cli } = await import('./issue-spill-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = 6022
const FOLLOW_UP = 6100
const EPIC = 6000
const ESTIMATE = ['--estimate', '2 ファイル / 40 行']
const ARGV = [String(ISSUE), ...ESTIMATE]
const DISTINCT = '--distinct'
const FOLLOW_UP_URL = `https://github.com/joshuafolkken/kit/issues/${String(FOLLOW_UP)}`
const LINK_LINE = `- → #${String(FOLLOW_UP)} に移した`
const UNCHECKED_BODY = '## 受け入れ条件\n\n- [x] done\n- [ ] left\n'
const CHECKED_BODY = '## 受け入れ条件\n\n- [x] done\n'

function read_of(body: string): { kind: 'read'; json: string } {
	return {
		kind: 'read',
		json: JSON.stringify({ title: 'Add a thing', body, labels: [{ name: 'run:lane' }] }),
	}
}

function listing(cutoff: string, index: Map<number, number>): void {
	fetch_epics_mock.mockResolvedValue({ epics: [], cutoff })
	build_epic_index_mock.mockReturnValue(index)
}

// The follow-up body `issue:file` was handed, read while its temporary file still exists.
async function filed_body(argv: ReadonlyArray<string>): Promise<string> {
	let body = ''

	file_issue_mock.mockImplementation(async (filing: ReadonlyArray<string>) => {
		body = await readFile(filing[filing.indexOf('--body-file') + 1] ?? '', 'utf8')

		return FOLLOW_UP_URL
	})
	listing('none', new Map([[ISSUE, EPIC]]))
	await issue_spill_cli.run(argv)

	return body
}

beforeEach(() => {
	for (const mock of [
		classified_mock,
		edit_body_mock,
		file_issue_mock,
		fetch_epics_mock,
		build_epic_index_mock,
		add_children_mock,
		create_epic_mock,
	]) {
		mock.mockReset()
	}

	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	classified_mock.mockResolvedValue(read_of(UNCHECKED_BODY))
	file_issue_mock.mockResolvedValue(FOLLOW_UP_URL)
	edit_body_mock.mockResolvedValue('')
	add_children_mock.mockResolvedValue(SUCCESS)
	create_epic_mock.mockResolvedValue(EPIC)
})

describe('issue_spill_cli.run', () => {
	it('refuses without --estimate and reads nothing', async () => {
		expect(await issue_spill_cli.run([String(ISSUE)])).toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(issue_spill_cli.USAGE)
		expect(classified_mock).not.toHaveBeenCalled()
	})

	it('writes nothing when every criterion is checked', async () => {
		classified_mock.mockResolvedValue(read_of(CHECKED_BODY))

		expect(await issue_spill_cli.run(ARGV)).toBe(SUCCESS)
		expect(file_issue_mock).not.toHaveBeenCalled()
		expect(edit_body_mock).not.toHaveBeenCalled()
		expect(fetch_epics_mock).not.toHaveBeenCalled()
	})

	it('files the follow-up with the split route, #N distinct and its triage label', async () => {
		listing('none', new Map([[ISSUE, EPIC]]))
		await issue_spill_cli.run(ARGV)

		expect(file_issue_mock).toHaveBeenCalledWith(
			expect.arrayContaining(['--route', 'split', DISTINCT, String(ISSUE), '--label', 'run:lane']),
		)
	})

	it('leaves #N untouched when the filing is refused', async () => {
		file_issue_mock.mockResolvedValue('')

		expect(await issue_spill_cli.run(ARGV)).toBe(FAILURE)
		expect(edit_body_mock).not.toHaveBeenCalled()
		expect(fetch_epics_mock).not.toHaveBeenCalled()
	})
})

describe('issue_spill_cli.run --distinct', () => {
	it('declares the given duplicate candidates separate beside #N', async () => {
		const distinct = [DISTINCT, '6677,6678', DISTINCT, '6679']

		listing('none', new Map([[ISSUE, EPIC]]))
		await issue_spill_cli.run([...ARGV, ...distinct])

		const argv: ReadonlyArray<string> = file_issue_mock.mock.calls[0]?.[0] ?? []

		expect(argv.join(' ')).toContain(`${DISTINCT} ${String(ISSUE)} ${distinct.join(' ')}`)
	})

	it('writes the given estimate into the filed body', async () => {
		const body = await filed_body([...ARGV, DISTINCT, '6677'])

		expect(body).toContain('- 規模見積もり: 約 2 ファイル / 40 行（テスト除く）')
	})

	it('writes the given --reason as the reason line after the estimate', async () => {
		const body = await filed_body([...ARGV, '--reason', '1 コミットで入れないと壊れる'])

		expect(body).toContain('行（テスト除く）\n- 分割しない理由: 1 コミットで入れないと壊れる\n')
	})

	it('refuses a blank --reason and reads nothing', async () => {
		expect(await issue_spill_cli.run([...ARGV, '--reason', ' '])).toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(issue_spill_cli.USAGE)
		expect(issue_spill_cli.USAGE).toContain('[--reason "<理由>"]')
		expect(classified_mock).not.toHaveBeenCalled()
	})
})

describe('issue_spill_cli.run placement', () => {
	it('places the follow-up after #N in its epic and leaves the link line', async () => {
		listing('none', new Map([[ISSUE, EPIC]]))

		expect(await issue_spill_cli.run(ARGV)).toBe(SUCCESS)
		expect(add_children_mock).toHaveBeenCalledWith({
			epic_number: EPIC,
			children: [FOLLOW_UP],
			position: { kind: 'after', target: ISSUE },
		})
		expect(edit_body_mock).toHaveBeenCalledWith(String(ISSUE), expect.stringContaining(LINK_LINE))
		expect(create_epic_mock).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('issue:file --publish <E>'))
	})

	it('creates an epic of #N and the follow-up when the full listing has none', async () => {
		listing('none', new Map())

		expect(await issue_spill_cli.run(ARGV)).toBe(SUCCESS)
		expect(create_epic_mock).toHaveBeenCalledWith(
			expect.objectContaining({ children: [ISSUE, FOLLOW_UP], is_ordered: true }),
		)
	})

	it('creates no epic when the listing was cut short', async () => {
		listing('row_limit', new Map())

		expect(await issue_spill_cli.run(ARGV)).toBe(FAILURE)
		expect(create_epic_mock).not.toHaveBeenCalled()
		expect(add_children_mock).not.toHaveBeenCalled()
	})
})

describe('issue_spill_cli.run failures after the filing', () => {
	const PLACE_HINT = `epic --add <E> ${String(FOLLOW_UP)} --after ${String(ISSUE)}`

	it('names the placing command when the epic refuses the follow-up', async () => {
		listing('none', new Map([[ISSUE, EPIC]]))
		add_children_mock.mockResolvedValue(FAILURE)

		expect(await issue_spill_cli.run(ARGV)).toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(PLACE_HINT))
	})

	it('skips the placement when #N cannot be rewritten', async () => {
		edit_body_mock.mockRejectedValue(new Error('HTTP 502'))

		expect(await issue_spill_cli.run(ARGV)).toBe(FAILURE)
		expect(fetch_epics_mock).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 502'))
	})
})
