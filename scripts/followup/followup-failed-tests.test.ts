import { realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { observation_record } from '#scripts/observations/observation-record'
import { review_comment_round } from '#scripts/review/review-comment-round'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	followup_failed_tests,
	KEPT_VERDICT,
	OBSERVATION_SLUG,
	RERUN_VERDICT,
	UNNAMED_VERDICT,
} from './followup-failed-tests'

const STAMP = '2026-10-27T10:00:00.1234567Z '
const BUDGET_TEST = 'scripts/run/board/run-board-frame-budget.test.ts'
const CLAIM_TEST = 'scripts/test/test-related.claim.test.ts'
const CLAIM_SUBJECT = 'scripts/test/test-related.ts'
const BUDGET_NAME = `${BUDGET_TEST} > frame budget > reads the budget`
const CLAIM_NAME = `|isolated| ${CLAIM_TEST} > claim > holds`
const ISSUE = 5197
const SIGHTING = `- k:${OBSERVATION_SLUG} | d1 | 2026-10-28 | ${BUDGET_TEST} | followup reran`
const FIFTH_SHARD = 'Unit Tests (5/6)'
const GRAPH_UNAVAILABLE = 'graph unavailable'
const FAILURES = [{ job: FIFTH_SHARD, tests: { files: [BUDGET_TEST], names: [BUDGET_NAME] } }]
const make_directory = temporary_directory()

async function indirect_fixture(): Promise<{
	test: string
	leaf: string
	read: ImportGraph['test_inputs']
}> {
	const root = realpathSync(make_directory('followup-indirect-'))
	const test = path.join(root, 'subject.test.ts')
	const leaf = path.join(root, 'leaf.ts')

	writeFileSync(
		path.join(root, 'tsconfig.json'),
		'{"compilerOptions":{"moduleResolution":"bundler"}}',
	)
	writeFileSync(test, "import { value } from './subject'\nexport const result = value\n")
	writeFileSync(path.join(root, 'subject.ts'), "export { value } from './leaf'\n")
	writeFileSync(leaf, 'export const value = 1\n')
	const graph = await import_graph.create(root)

	return { test, leaf, read: graph?.test_inputs }
}

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_comment: vi.fn() },
}))
vi.mock('#scripts/observations/observation-record', () => ({
	observation_record: { assess: vi.fn(), record: vi.fn() },
	REFUSED_VERDICT: 'refused',
}))

beforeEach(() => {
	vi.mocked(git_gh_issue_write.issue_comment).mockReset().mockResolvedValue('https://comment')
	vi.mocked(observation_record.assess)
		.mockReset()
		.mockResolvedValue({ verdict: 'ledger', earlier: [], line: SIGHTING })
	vi.mocked(observation_record.record).mockReset()
})

function tests_of(...files: Array<string>): { files: Array<string>; names: Array<string> } {
	return { files, names: files.map((file) => `${file} > suite > test`) }
}

describe('followup_failed_tests.read_failed_tests', () => {
	it('reads the failed tests from a GitHub Actions log, timestamps and project labels included', () => {
		const log = [
			`${STAMP}::group::Run pnpm josh test:unit --shard=5/6`,
			`${STAMP} FAIL  ${BUDGET_NAME}`,
			`${STAMP}\u{1B}[31m FAIL \u{1B}[39m ${CLAIM_NAME}`,
			`${STAMP} FAIL  ${BUDGET_NAME}`,
		].join('\n')

		expect(followup_failed_tests.read_failed_tests(log)).toStrictEqual({
			files: [BUDGET_TEST, CLAIM_TEST],
			names: [BUDGET_NAME, CLAIM_NAME],
		})
	})

	it('reads nothing from a job that failed on anything but a test', () => {
		const log = `${STAMP}Error: eslint found 2 problems\n${STAMP}##[error]Process completed with exit code 1.`

		expect(followup_failed_tests.read_failed_tests(log)).toStrictEqual({ files: [], names: [] })
	})
})

describe('followup_failed_tests.subjects_of', () => {
	it('names the test file and the module each leading run of its segments names', () => {
		expect(followup_failed_tests.subjects_of(CLAIM_TEST)).toStrictEqual([
			CLAIM_TEST,
			CLAIM_SUBJECT,
			'scripts/test/test-related.claim.ts',
		])
	})

	it('names only the file itself when it is not a test file', () => {
		const script = 'tools/check.sh'

		expect(followup_failed_tests.subjects_of(script)).toStrictEqual([script])
	})
})

describe('followup_failed_tests.verdict_of', () => {
	it('follows an indirect runtime import while the test and its direct subject are unchanged', async () => {
		const { test, leaf, read } = await indirect_fixture()

		expect(read).toBeTypeOf('function')
		expect(followup_failed_tests.verdict_of(tests_of(test), new Set([leaf]), read)).toBe(
			KEPT_VERDICT,
		)
		expect(followup_failed_tests.verdict_of(tests_of(test), new Set(['unrelated.ts']), read)).toBe(
			RERUN_VERDICT,
		)
	})

	it.each([undefined, () => undefined, () => []])('keeps unknown dependency inputs: %s', (read) => {
		expect(followup_failed_tests.verdict_of(tests_of(BUDGET_TEST), new Set(), read)).toBe(
			KEPT_VERDICT,
		)
	})

	it('keeps a failure when the shared test configuration changed', () => {
		const tests = tests_of(BUDGET_TEST)

		expect(
			followup_failed_tests.verdict_of(tests, new Set(['vitest.config.ts']), (file) => [file]),
		).toBe(KEPT_VERDICT)
	})
})

describe('followup_failed_tests.verdict_of — direct subjects and pins', () => {
	it('reruns when no failed test or its subject moved', () => {
		const changed = new Set(['scripts/followup/followup-job-rerun.ts'])
		const tests = tests_of(BUDGET_TEST, CLAIM_TEST)

		expect(followup_failed_tests.verdict_of(tests, changed, (file) => [file])).toBe(RERUN_VERDICT)
	})

	it.each([
		['the test file itself', BUDGET_TEST],
		['its subject module', CLAIM_SUBJECT],
	])('keeps the failure when one failed test belongs to the change through %s', (_label, moved) => {
		const tests = tests_of(BUDGET_TEST, CLAIM_TEST)

		expect(followup_failed_tests.verdict_of(tests, new Set([moved]))).toBe(KEPT_VERDICT)
	})

	// joshuafolkken/kit#5642: a command-table change pins the registry tests, so their failure is its own.
	it('keeps an ALIASES failure when the change touched the command table', () => {
		const tests = tests_of('scripts/josh/josh-logic.test.ts')
		const changed = new Set(['scripts/josh/josh-commands-development.ts'])

		expect(followup_failed_tests.verdict_of(tests, changed)).toBe(KEPT_VERDICT)
	})

	it('answers unnamed when the log named no failed test', () => {
		expect(followup_failed_tests.verdict_of(tests_of(), new Set())).toBe(UNNAMED_VERDICT)
	})
})

describe('followup_failed_tests.read_verdict — unknown inputs', () => {
	it('keeps the failure when no dependency graph is available', async () => {
		vi.spyOn(import_graph, 'create').mockResolvedValueOnce(undefined)

		await expect(
			followup_failed_tests.read_verdict(tests_of(BUDGET_TEST), new Set()),
		).resolves.toBe(KEPT_VERDICT)
	})

	it('propagates an exploration error so the caller preserves the original CI failure', async () => {
		vi.spyOn(import_graph, 'create').mockRejectedValueOnce(new Error(GRAPH_UNAVAILABLE))

		await expect(
			followup_failed_tests.read_verdict(tests_of(BUDGET_TEST), new Set()),
		).rejects.toThrow(GRAPH_UNAVAILABLE)
	})

	it('keeps an import diagnostic even when no test file was named', async () => {
		const log = 'Error: [vitest] No "constants" export is defined on the "node:fs" mock.'
		const tests = followup_failed_tests.read_failed_tests(log)

		await expect(followup_failed_tests.read_verdict(tests, new Set())).resolves.toBe(KEPT_VERDICT)
	})
})

describe('followup_failed_tests.observation_of', () => {
	it('names the reran jobs, the failed files and each test once, with no field separator inside', () => {
		const entry = followup_failed_tests.observation_of([
			{ job: FIFTH_SHARD, tests: { files: [CLAIM_TEST], names: [CLAIM_NAME] } },
			{ job: 'Unit Tests (2/6)', tests: { files: [CLAIM_TEST], names: [CLAIM_NAME] } },
		])

		expect(entry).toStrictEqual({
			slug: OBSERVATION_SLUG,
			depth: 'd1',
			where: CLAIM_TEST,
			what: `followup reran Unit Tests (5/6), Unit Tests (2/6); failed outside the change: /isolated/ ${CLAIM_TEST} > claim > holds`,
		})
	})
})

// joshuafolkken/kit#5197: the rerun happens after the ledger's last commit, so the sighting goes to the
// issue, from which `review_comment_round.carry` brings it into the ledger once the issue closes.
describe('followup_failed_tests.record', () => {
	it('posts the sighting on the issue under the observation heading, appending nothing to the tree', async () => {
		await followup_failed_tests.record(FAILURES, ISSUE)

		expect(git_gh_issue_write.issue_comment).toHaveBeenCalledWith(
			String(ISSUE),
			review_comment_round.observation_body_of([SIGHTING]),
		)
		expect(observation_record.record).not.toHaveBeenCalled()
	})

	it.each([
		['a branch naming no issue', FAILURES, undefined],
		['no failure outside the change', [], ISSUE],
	])('posts nothing for %s', async (_label, failures, issue) => {
		await followup_failed_tests.record(failures, issue)

		expect(observation_record.assess).not.toHaveBeenCalled()
		expect(git_gh_issue_write.issue_comment).not.toHaveBeenCalled()
	})

	it('posts nothing for a sighting the ledger grammar refuses', async () => {
		vi.mocked(observation_record.assess).mockResolvedValue({ verdict: 'refused', reason: 'bad' })

		await followup_failed_tests.record(FAILURES, ISSUE)

		expect(git_gh_issue_write.issue_comment).not.toHaveBeenCalled()
	})

	it('reports a post that failed without stopping the rerun', async () => {
		vi.mocked(git_gh_issue_write.issue_comment).mockRejectedValue(new Error('HTTP 502'))

		await expect(followup_failed_tests.record(FAILURES, ISSUE)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#5316: the main merge put before a rerun posts its own line the same way.
describe('followup_failed_tests.record_entry', () => {
	const entry = { slug: 'followup-main-merge-first', depth: 'd1', where: BUDGET_TEST, what: 'x' }

	it('posts a given ledger entry on the issue', async () => {
		await followup_failed_tests.record_entry(entry, ISSUE)

		expect(observation_record.assess).toHaveBeenCalledWith(expect.objectContaining({ entry }))
		expect(git_gh_issue_write.issue_comment).toHaveBeenCalledWith(
			String(ISSUE),
			review_comment_round.observation_body_of([SIGHTING]),
		)
	})

	it('names the entry slug and the verdict in the console line', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await followup_failed_tests.record_entry(entry, ISSUE)

		expect(info).toHaveBeenCalledWith(
			'📝 Recorded the followup-main-merge-first observation: ledger',
		)
		info.mockRestore()
	})

	it('names the entry slug and the error in the console line of a failed post', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.mocked(git_gh_issue_write.issue_comment).mockRejectedValue(new Error('HTTP 502'))

		await followup_failed_tests.record_entry(entry, ISSUE)

		expect(info).toHaveBeenCalledWith(
			'⚠️ Could not record the followup-main-merge-first observation: Error: HTTP 502',
		)
		info.mockRestore()
	})
})
