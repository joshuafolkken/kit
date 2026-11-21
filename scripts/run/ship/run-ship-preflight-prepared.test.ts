import { beforeEach, expect, it, vi } from 'vitest'

const prepared_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const reuse_mock = vi.hoisted(() => vi.fn())
const record_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('8542-lane') },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_get_body: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_preflight: record_mock },
}))
vi.mock('./run-ship-body-draft', () => ({
	run_ship_body_draft: { existing: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('./run-ship-preflight-reuse', () => ({ run_ship_preflight_reuse: { run: reuse_mock } }))
vi.mock('./run-ship-prepared-children', () => ({
	run_ship_prepared_children: { PRECONDITION: 'prepared', problems: prepared_mock },
}))

const { run_ship_preflight } = await import('./run-ship-preflight')

// joshuafolkken/kit#8542: a child filed after a passed preflight leaves the tree unmoved, so the
// prepared children are asked ahead of the reuse on every ship rather than inside the reused pass.

const REQUEST = { title: 'Publish prepared children #8542', body_path: undefined }
const REUSED = { code: 0, out: 'ready — preflight reused' }
const UNPUBLISHED = '#8600 has no recorded plan'

beforeEach(() => {
	prepared_mock.mockReset().mockResolvedValue([])
	reuse_mock.mockReset().mockResolvedValue(REUSED)
	record_mock.mockReset().mockResolvedValue(undefined)
})

it('refuses an unplanned prepared child where the pass would be reused', async () => {
	prepared_mock.mockResolvedValue([UNPUBLISHED])

	const result = await run_ship_preflight.stage(REQUEST)

	expect(result).toMatchObject({ code: 1, preconditions: ['prepared'] })
	expect(result.out).toContain(`  - ${UNPUBLISHED}`)
	expect(reuse_mock).not.toHaveBeenCalled()
	expect(record_mock).toHaveBeenCalledWith({
		issue: 8542,
		evaluated: ['prepared'],
		unmet: ['prepared'],
	})
})

it('asks the prepared children before handing an unchanged tree to the reuse', async () => {
	await expect(run_ship_preflight.stage(REQUEST)).resolves.toEqual(REUSED)
	expect(prepared_mock).toHaveBeenCalledOnce()
	expect(reuse_mock).toHaveBeenCalledOnce()
})
