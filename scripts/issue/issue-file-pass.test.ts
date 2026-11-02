import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file, type FileArguments } from './issue-file'
import { issue_file_lane_hint } from './issue-file-lane-hint'
import { issue_file_pass, type Filing } from './issue-file-pass'
import { issue_sample_source } from './issue-sample-source'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#5833: every step of the pass runs whatever the others answer, so one call prints
// the body lint's refusal and the duplicate scout's together, and the scout's refusal names a
// `--distinct` that keeps the candidates the call already declared.

const HERE = 'joshuafolkken/kit'
const DECLARED = 2795
const DUPLICATE_A = 2801
const DUPLICATE_B = 2802
const SOURCE_PROBLEM = 'the start condition cites an issue'

// Opted into `auto-ok` with no run label named, and missing every section after the background.
const REFUSED_BODY = '## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n'

// Every local check passes: a judgement-needed body is not opted into `auto-ok`, so it owes no run label.
const CLEAR_BODY = [
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	'- 人の判断: 要（目視確認）',
	'',
	'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
].join('\n')

function args_of(extra: ReadonlyArray<string> = []): FileArguments {
	const args = issue_file.parse(['A title', '--body-file', 'body.md', ...extra])

	if (args === undefined) throw new Error('the test arguments did not parse')

	return args
}

function filing_of(body: string, args: FileArguments = args_of()): Filing {
	return { args, body, target: HERE, current: HERE }
}

function printed(): string {
	return vi.mocked(console.error).mock.calls.join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(issue_file_lane_hint, 'lines_of').mockResolvedValue([])
	vi.spyOn(issue_sample_source, 'problem').mockResolvedValue(undefined)
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({
		report: 'Duplicates: none',
		candidates: [],
	})
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	vi.restoreAllMocks()
})

describe('issue_file_pass.labels_in_one_pass — every refusal in one call', () => {
	it('prints the body lint and the duplicate scout refusals together', async () => {
		vi.mocked(issue_scout_cli.scout).mockResolvedValue({
			report: 'Duplicates: 1',
			candidates: [DUPLICATE_A],
		})

		expect(await issue_file_pass.labels_in_one_pass(filing_of(REFUSED_BODY))).toBeUndefined()

		for (const refusal of ['## 現象', '--label run:solo', `--distinct ${String(DUPLICATE_A)}`]) {
			expect(printed()).toContain(refusal)
		}
	})

	it('reads the start condition and the WIP count while the body is refused', async () => {
		vi.mocked(issue_sample_source.problem).mockResolvedValue(SOURCE_PROBLEM)

		await issue_file_pass.labels_in_one_pass(filing_of(REFUSED_BODY))

		expect(printed()).toContain(SOURCE_PROBLEM)
		expect(git_gh_issue_list.issue_list).toHaveBeenCalledOnce()
	})

	it('names every candidate in the --distinct to paste, the declared ones kept', async () => {
		vi.mocked(issue_scout_cli.scout).mockResolvedValue({
			report: 'Duplicates: 3',
			candidates: [DECLARED, DUPLICATE_A, DUPLICATE_B],
		})
		const filing = filing_of(CLEAR_BODY, args_of(['--distinct', String(DECLARED)]))

		expect(await issue_file_pass.labels_in_one_pass(filing)).toBeUndefined()
		const pasted = [DECLARED, DUPLICATE_A, DUPLICATE_B].map(String).join(',')

		expect(printed()).toContain(`--distinct ${pasted}`)
	})

	it('answers the labels when no step refuses', async () => {
		expect(await issue_file_pass.labels_in_one_pass(filing_of(CLEAR_BODY))).toBeDefined()
		expect(console.error).not.toHaveBeenCalled()
	})
})
