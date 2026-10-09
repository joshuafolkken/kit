import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { report_format_reference } from '#scripts/report/report-format-reference'
import { live_evidence } from '#scripts/review/live-evidence'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const problems_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const paths_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const pr_body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const scoped_mock = vi.hoisted(() => vi.fn())
const classification_mock = vi.hoisted(() => vi.fn<() => Promise<void>>())
const lock_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())

vi.mock('#scripts/git/git-preflight', () => ({
	git_preflight: { problems_of: problems_mock },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: paths_mock },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { pr_get_body: pr_body_mock } }))
vi.mock('#scripts/gh/git-pr', () => ({
	git_pr: { release_classification: classification_mock },
}))
vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('2946-lane') },
}))
vi.mock('./run-ship-scoped', () => ({ run_ship_scoped: { scoped_pair: scoped_mock } }))
vi.mock('./run-ship-lock', () => ({ run_ship_lock: { lock_problems: lock_mock } }))

const { run_ship_preflight } = await import('./run-ship-preflight')

// joshuafolkken/kit#2946: the pull request's preconditions — `git -y`'s preflight and `followup`'s
// live-evidence gate — are asked before the review and the gate, all at once, and the scoped pair is met
// only once they hold.

const OK = 0
const FAILED = 1
const TITLE = 'Front-load the ship checks #2946'
const RUNTIME_PATHS = ['scripts/run/ship/run-ship-cli.ts']
const NO_BODY = { title: TITLE, body_path: undefined }
const READY = { code: OK, out: 'ready' }
const SCOPED_RED = { code: FAILED, out: 'lint:related red' }
const DOCS_PATHS = ['docs/josh-commands.md']
const CLASSIFICATION = 'Choose one release classification before opening the PR'
const ISSUE = '3154'
const EVIDENCE_BODY =
	'## 実機証跡\n\n`pnpm josh ship --log 2946`\n\n```\nstopped at: === preflight ===\n```\n'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-preflight-'))
const MISSING_BODY = path.join(TEMPORARY, 'missing.md')
const TWO_PROBLEMS = '2 pull-request precondition(s)'
const GIT_FAILURE = 'git status failed'

function body_file(text: string): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.md`)

	writeFileSync(target, text)

	return target
}

beforeEach(() => {
	problems_mock.mockReset().mockResolvedValue([])
	paths_mock.mockReset().mockResolvedValue(DOCS_PATHS)
	pr_body_mock.mockReset().mockResolvedValue(undefined)
	scoped_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	classification_mock.mockReset().mockResolvedValue()
	lock_mock.mockReset().mockResolvedValue([])
})

// joshuafolkken/kit#3307: a drifted lock stops the ship before the gate, with its reason.
describe('run_ship_preflight.stage — the lock file', () => {
	it('stops before the scoped pair on a drifted lock, naming it', async () => {
		lock_mock.mockResolvedValue(['pnpm-lock.yaml does not match its inputs'])

		const result = await run_ship_preflight.stage(NO_BODY)

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain('  - pnpm-lock.yaml does not match its inputs')
		expect(scoped_mock).not.toHaveBeenCalled()
	})
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_ship_preflight.stage — every pull-request precondition at once', () => {
	it('reports the classification and the missing evidence together, before the scoped pair', async () => {
		problems_mock.mockResolvedValue([CLASSIFICATION])
		paths_mock.mockResolvedValue(RUNTIME_PATHS)

		const result = await run_ship_preflight.stage(NO_BODY)

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain(TWO_PROBLEMS)
		expect(result.out).toContain(CLASSIFICATION)
		expect(result.out).toContain(run_ship_preflight.EVIDENCE_PROBLEM)
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	it('asks the git preflight with the ship title, as a pull request will be opened', async () => {
		await run_ship_preflight.stage(NO_BODY)

		expect(problems_mock).toHaveBeenCalledWith({ cli_input: TITLE, will_open_pr: true })
	})

	it('reads the evidence from the --body-file the ship will deliver', async () => {
		paths_mock.mockResolvedValue(RUNTIME_PATHS)

		const result = await run_ship_preflight.stage({
			title: TITLE,
			body_path: body_file(EVIDENCE_BODY),
		})

		expect(result.code).toBe(OK)
		expect(pr_body_mock).not.toHaveBeenCalled()
	})

	it('reads the evidence from the open pull request when no body file is given', async () => {
		paths_mock.mockResolvedValue(RUNTIME_PATHS)
		pr_body_mock.mockResolvedValue(EVIDENCE_BODY)

		expect(await run_ship_preflight.stage(NO_BODY)).toStrictEqual(READY)
		expect(pr_body_mock).toHaveBeenCalledWith('2946-lane')
	})

	it('asks no evidence of a change that touches no runtime code', async () => {
		expect(await run_ship_preflight.stage(NO_BODY)).toStrictEqual(READY)
	})
})

describe('run_ship_preflight.stage — a precondition that cannot be read', () => {
	it('fails as a stage rather than throwing when the --body-file cannot be read', async () => {
		const result = await run_ship_preflight.stage({ title: TITLE, body_path: MISSING_BODY })

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain('1 pull-request precondition(s)')
		expect(result.out).toContain(MISSING_BODY)
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	it('still reports the git preflight problems when the --body-file cannot be read', async () => {
		problems_mock.mockResolvedValue([CLASSIFICATION])
		const result = await run_ship_preflight.stage({ title: TITLE, body_path: MISSING_BODY })

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain(TWO_PROBLEMS)
		expect(result.out).toContain(CLASSIFICATION)
		expect(result.out).toContain(MISSING_BODY)
	})

	it('still reports the evidence problem when the git preflight read throws', async () => {
		problems_mock.mockRejectedValue(new Error(GIT_FAILURE))
		paths_mock.mockResolvedValue(RUNTIME_PATHS)

		const result = await run_ship_preflight.stage(NO_BODY)

		expect(result.out).toContain(GIT_FAILURE)
		expect(result.out).toContain(run_ship_preflight.EVIDENCE_PROBLEM)
	})
})

describe('run_ship_preflight.stage — the scoped pair once the preconditions hold', () => {
	it('runs the scoped pair and passes when it is green', async () => {
		const result = await run_ship_preflight.stage(NO_BODY)

		expect(scoped_mock).toHaveBeenCalledOnce()
		expect(result).toStrictEqual(READY)
	})

	it('stops on a red scoped check, its output forwarded', async () => {
		scoped_mock.mockResolvedValue(SCOPED_RED)

		expect(await run_ship_preflight.stage(NO_BODY)).toStrictEqual(SCOPED_RED)
	})
})

// joshuafolkken/kit#3154: the classification and evidence refusals are asked before the ship, by
// `run:prep` and `run:step`, so they are met while the context is still small.
describe('run_ship_preflight.ahead — the ship refusals asked early', () => {
	it('returns the classification failure as a problem rather than throwing', async () => {
		classification_mock.mockRejectedValue(new Error(CLASSIFICATION))

		expect(await run_ship_preflight.ahead(ISSUE)).toStrictEqual([CLASSIFICATION])
		expect(classification_mock).toHaveBeenCalledWith(ISSUE, '2946-lane')
	})

	it('asks for the evidence file, not a failed body, for a runtime change with no PR yet', async () => {
		paths_mock.mockResolvedValue(RUNTIME_PATHS)

		expect(await run_ship_preflight.ahead(ISSUE)).toStrictEqual([
			run_ship_preflight.EVIDENCE_PENDING,
		])
	})

	it('reports the missing evidence of an open PR body that lacks it', async () => {
		paths_mock.mockResolvedValue(RUNTIME_PATHS)
		pr_body_mock.mockResolvedValue('## Summary\n')

		expect(await run_ship_preflight.ahead(ISSUE)).toStrictEqual([
			run_ship_preflight.EVIDENCE_PROBLEM,
		])
	})

	it('finds nothing for a docs-only change with a classification', async () => {
		expect(await run_ship_preflight.ahead(ISSUE)).toStrictEqual([])
	})
})

// joshuafolkken/kit#3422: the evidence stop named the heading but not its shape, so the reader went
// looking for the format. Both wordings now carry the heading, the shape and the document section.
describe('run_ship_preflight — the evidence problems name the format', () => {
	it.each([
		['EVIDENCE_PROBLEM', run_ship_preflight.EVIDENCE_PROBLEM],
		['EVIDENCE_PENDING', run_ship_preflight.EVIDENCE_PENDING],
	])('%s carries the heading and the format with its document', (_name, problem) => {
		expect(problem).toContain(live_evidence.EVIDENCE_HEADING)
		expect(problem).toContain(live_evidence.EVIDENCE_FORMAT)
		expect(problem).toContain(report_format_reference.REPORT_FORMAT_PATH)
	})
})
