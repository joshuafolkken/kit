import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const pr_body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const issue_body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const acceptance_mock = vi.hoisted(() =>
	vi.fn<(issue: string, body: string | undefined) => Promise<string | undefined>>(),
)
const draft_mock = vi.hoisted(() => vi.fn<(issue: string) => Promise<string | undefined>>())
const prepare_mock = vi.hoisted(() => vi.fn<(issue: string, rows: string) => Promise<string>>())
const paths_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())

vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: paths_mock },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_get_body: pr_body_mock, issue_get_body: issue_body_mock },
}))
vi.mock('#scripts/gh/git-pr', () => ({
	git_pr: { release_classification: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('4168-lane') },
}))
vi.mock('#scripts/review/acceptance-map-check', () => ({
	acceptance_map_check: { body_refusal: acceptance_mock },
}))
vi.mock('./run-ship-body-draft', () => ({
	run_ship_body_draft: { existing: draft_mock, prepare: prepare_mock },
}))

const { run_ship_preflight } = await import('./run-ship-preflight')

// joshuafolkken/kit#4168: the acceptance rows `run:prep` and `run:step` print land in the ship body
// draft `josh ship` reads, and a later refusal of that draft still names it.

const ISSUE = '4168'
const UNMAPPED = '`ac-12345678` has no row'
const OPEN_PR_BODY = '## Summary\n'
const FILLED_BODY = '## 受け入れ条件の対応\n\n## 実機証跡\n'
const ONE_CRITERION_BODY = '## 受け入れ条件\n\n- [ ] the first criterion\n'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-preflight-draft-'))
const DRAFT_PATH = path.join(TEMPORARY, 'josh-ship-body-4168.md')

beforeEach(() => {
	pr_body_mock.mockReset().mockResolvedValue(undefined)
	issue_body_mock.mockReset().mockResolvedValue(ONE_CRITERION_BODY)
	acceptance_mock.mockReset().mockResolvedValue(UNMAPPED)
	draft_mock.mockReset().mockResolvedValue(undefined)
	prepare_mock.mockReset().mockResolvedValue(DRAFT_PATH)
	paths_mock.mockReset().mockResolvedValue(['docs/josh-commands.md'])
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_ship_preflight.ahead — the ship body draft', () => {
	it('writes the skeleton into the ship body draft and names its path', async () => {
		const [problem] = await run_ship_preflight.ahead(ISSUE)

		expect(prepare_mock).toHaveBeenCalledWith(ISSUE, acceptance_map.skeleton(ONE_CRITERION_BODY))
		expect(problem).toContain(DRAFT_PATH)
	})

	it('reads a draft the run filled in over the open PR body', async () => {
		writeFileSync(DRAFT_PATH, FILLED_BODY)
		draft_mock.mockResolvedValue(DRAFT_PATH)
		acceptance_mock.mockResolvedValue(undefined)
		pr_body_mock.mockResolvedValue(OPEN_PR_BODY)

		expect(await run_ship_preflight.ahead(ISSUE)).toStrictEqual([])
		expect(draft_mock).toHaveBeenCalledWith(ISSUE)
		expect(acceptance_mock).toHaveBeenCalledWith(ISSUE, FILLED_BODY)
		expect(pr_body_mock).not.toHaveBeenCalled()
		expect(prepare_mock).not.toHaveBeenCalled()
	})

	it('names a draft still refused, keeping the refusal', async () => {
		writeFileSync(DRAFT_PATH, FILLED_BODY)
		draft_mock.mockResolvedValue(DRAFT_PATH)

		expect(await run_ship_preflight.ahead(ISSUE)).toStrictEqual([
			`${run_ship_preflight.acceptance_pending_text(DRAFT_PATH)}\n${UNMAPPED}`,
		])
		expect(prepare_mock).not.toHaveBeenCalled()
	})

	it('points a runtime change whose draft has no evidence back at the draft', async () => {
		writeFileSync(DRAFT_PATH, FILLED_BODY)
		draft_mock.mockResolvedValue(DRAFT_PATH)
		acceptance_mock.mockResolvedValue(undefined)
		paths_mock.mockResolvedValue(['scripts/run/ship/run-ship-cli.ts'])

		const [problem] = await run_ship_preflight.ahead(ISSUE)

		expect(problem).toBe(run_ship_preflight.EVIDENCE_PROBLEM)
		expect(problem).toContain('ship body draft')
	})
})
