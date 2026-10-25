import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state } from '#scripts/lane/lane-state'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { backlog_next, type PoolContext } from './backlog-next'

// joshuafolkken/kit#4864: a candidate waits on the files a running lane plans to edit as it waits on its
// body's.

const ROOT = mkdtempSync(path.join(tmpdir(), 'backlog-next-scope-'))
const RUNNING = 4858
const BODY_FILE = 'scripts/backlog/backlog-rank.ts'
const PLANNED_FILE = 'scripts/lane/lane-overrun.ts'

const CONTEXT: PoolContext = {
	opted_in: {
		kind: 'read',
		issues: [
			{
				number: RUNNING,
				title: 'Running lane',
				labels: [],
				createdAt: '2026-10-25T00:00Z',
				body: `Touches \`${BODY_FILE}\`.`,
			},
		],
		cutoff: 'none',
	},
	tracking: { kind: 'read', index: new Map(), cutoff: 'none' },
	repo: 'joshuafolkken/kit',
	exclude: [],
}

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('backlog_next.gate_scope', () => {
	// joshuafolkken/kit#4937: the recorded plan replaces the body, so a path the body only cites holds nothing.
	it("reads a running lane's recorded plan in place of the paths its body declares", async () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(ROOT)
		vi.spyOn(lane_state, 'read_states').mockResolvedValue(new Map())
		lane_plan.record(
			{ issue: RUNNING, paths: [PLANNED_FILE], planned_at: '2026-10-25T03:10:00.000Z' },
			process.cwd(),
		)

		const scope = await backlog_next.gate_scope(CONTEXT)

		expect([...(scope.declared.get(RUNNING) ?? [])]).toEqual([PLANNED_FILE])
	})
})
