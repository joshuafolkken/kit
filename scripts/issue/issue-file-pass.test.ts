import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { lane_net_read } from '#scripts/lane/lane-net-read'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_cap_files } from './issue-cap-files'
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
const DISTINCT = '--distinct'
const NO_DUPLICATES = { report: 'Duplicates: none', candidates: [] }

// Opted into `auto-ok` with no run label named, and missing every section after the background.
const REFUSED_BODY = '## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n'

const CLEAR_ESTIMATE = '- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）'

// Every local check passes: a judgement-needed body is not opted into `auto-ok`, so it owes no run label.
const CLEAR_BODY = [
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	CLEAR_ESTIMATE,
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
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue(NO_DUPLICATES)
	vi.spyOn(lane_net_read, 'measurements').mockResolvedValue({
		implement_rate: undefined,
		growth: {},
	})
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
		const filing = filing_of(CLEAR_BODY, args_of([DISTINCT, String(DECLARED)]))

		expect(await issue_file_pass.labels_in_one_pass(filing)).toBeUndefined()
		const pasted = [DECLARED, DUPLICATE_A, DUPLICATE_B].map(String).join(',')

		expect(printed()).toContain(`--distinct ${pasted}`)
	})

	it('answers the labels when no step refuses', async () => {
		expect(await issue_file_pass.labels_in_one_pass(filing_of(CLEAR_BODY))).toBeDefined()
		expect(console.error).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7184: a named file near its code-line cap refuses a filing into this repository
// alone — another repository's files are not in this checkout.
describe('issue_file_pass.labels_in_one_pass — a named file near its cap', () => {
	const CAP_PROBLEM = 'names a.ts, at or past 90% of the code-line limit'

	beforeEach(() => {
		vi.spyOn(issue_cap_files, 'near_cap').mockResolvedValue([
			{ file_path: 'a.ts', limit: 300, budget: undefined },
		])
		vi.spyOn(issue_cap_files, 'problem').mockReturnValue(CAP_PROBLEM)
	})

	afterEach(() => {
		vi.mocked(issue_cap_files.near_cap).mockRestore()
		vi.mocked(issue_cap_files.problem).mockRestore()
	})

	it('refuses a filing into this repository and prints the refactor-first route', async () => {
		expect(await issue_file_pass.labels_in_one_pass(filing_of(CLEAR_BODY))).toBeUndefined()
		expect(printed()).toContain(`✖ ${CAP_PROBLEM}`)
	})

	it('does not weigh a filing into another repository', async () => {
		const filing = { ...filing_of(CLEAR_BODY), target: 'joshuafolkken/other' }

		await issue_file_pass.labels_in_one_pass(filing)

		expect(printed()).not.toContain(CAP_PROBLEM)
	})
})

// joshuafolkken/kit#7021: the figure-source warning prints from issue:file too, never refusing.
describe('issue_file_pass.labels_in_one_pass — a figure with no source', () => {
	it('warns about a background figure with no source and still answers the labels', async () => {
		const body = CLEAR_BODY.replace('## 現象', '中央値 約 35 分\n\n## 現象')

		vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(await issue_file_pass.labels_in_one_pass(filing_of(body))).toBeDefined()
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringMatching(/^⚠ number with no source .*約 35 分/u),
		)
	})
})

// joshuafolkken/kit#6008: an open issue declaring the same measurement holds the filing, and no
// `--distinct` releases it.
describe('issue_file_pass.labels_in_one_pass — a measurement already declared', () => {
	it('refuses it and names the open issue, --distinct notwithstanding', async () => {
		vi.mocked(issue_scout_cli.scout).mockResolvedValue({
			...NO_DUPLICATES,
			measure_twins: [DUPLICATE_A],
		})
		const filing = filing_of(CLEAR_BODY, args_of([DISTINCT, String(DUPLICATE_A)]))

		expect(await issue_file_pass.labels_in_one_pass(filing)).toBeUndefined()
		expect(printed()).toContain(`#${String(DUPLICATE_A)}`)
		expect(printed()).toContain('issue:comment')
	})

	it('answers the labels when no open issue declares it', async () => {
		vi.mocked(issue_scout_cli.scout).mockResolvedValue({ ...NO_DUPLICATES, measure_twins: [] })

		expect(await issue_file_pass.labels_in_one_pass(filing_of(CLEAR_BODY))).toBeDefined()
	})
})

// joshuafolkken/kit#6025: the size estimate is judged at the ledger's recent implement rate.
describe('issue_file_pass.labels_in_one_pass — the implement rate', () => {
	it('admits measured growth under the guide when no speed is measured', async () => {
		vi.mocked(lane_net_read.measurements).mockResolvedValue({
			implement_rate: undefined,
			growth: { files: 1, lines: 1 },
		})
		const body = CLEAR_BODY.replace(
			CLEAR_ESTIMATE,
			'- 規模見積もり: 約 6 ファイル / 150 行（テスト除く）',
		)

		expect(await issue_file_pass.labels_in_one_pass(filing_of(body))).toBeDefined()
	})
})

describe('issue_file_pass.labels_in_one_pass — measured speed', () => {
	it('refuses an unreasoned estimate the ledger rate projects past the budget', async () => {
		vi.mocked(lane_net_read.measurements).mockResolvedValue({
			implement_rate: { median: 10, lanes: 4 },
			growth: {},
		})
		const body = CLEAR_BODY.replace(
			CLEAR_ESTIMATE,
			'- 規模見積もり: 約 1 ファイル / 100 行（テスト除く）',
		)

		expect(await issue_file_pass.labels_in_one_pass(filing_of(body))).toBeUndefined()
		expect(printed()).toContain('size bar')
	})

	// joshuafolkken/kit#7074: the bar is twice the implement budget — 50 declared lines at this rate.
	it.each([
		{ lines: 50, passes: true },
		{ lines: 51, passes: false },
	])('judges $lines declared lines at the measured rate', async ({ lines, passes }) => {
		vi.mocked(lane_net_read.measurements).mockResolvedValue({
			implement_rate: { median: 17.7, lanes: 316 },
			growth: {},
		})
		const estimate = `- 規模見積もり: 約 1 ファイル / ${String(lines)} 行（テスト除く）`
		const body = CLEAR_BODY.replace(CLEAR_ESTIMATE, () => estimate)

		const labels = await issue_file_pass.labels_in_one_pass(filing_of(body))

		expect(labels !== undefined).toBe(passes)
	})
})
