import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { epic_graph } from '#scripts/epic/epic-graph'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state } from '#scripts/lane/lane-state'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_gate_scope, type PoolContext } from './backlog-gate-scope'

// joshuafolkken/kit#4864: a candidate waits on the files a running lane plans to edit as it waits on its
// body's. joshuafolkken/kit#5107: an issue that yielded its lane is named, so the offer puts it first.

const ROOT = mkdtempSync(path.join(tmpdir(), 'backlog-gate-scope-'))
const REPO = 'joshuafolkken/kit'
const RUNNING = 4858
const YIELDED = 5083
const BODY_FILE = 'scripts/backlog/backlog-rank.ts'
const PLANNED_FILE = 'scripts/lane/lane-overrun.ts'
const PLANNED_AT = '2026-10-25T03:10:00.000Z'

function issue(number: number): PoolContext['opted_in']['issues'][number] {
	return {
		number,
		title: 'Lane',
		labels: [],
		createdAt: '2026-10-25T00:00Z',
		body: `Touches \`${BODY_FILE}\`.`,
	}
}

const CONTEXT: PoolContext = {
	opted_in: { kind: 'read', issues: [issue(RUNNING), issue(YIELDED)], cutoff: 'none' },
	tracking: { kind: 'read', index: new Map(), cutoff: 'none' },
	repo: REPO,
	exclude: [],
}

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(ROOT)
	vi.spyOn(lane_state, 'read_states').mockResolvedValue(new Map())
	lane_plan.record({ issue: RUNNING, paths: [PLANNED_FILE], planned_at: PLANNED_AT }, process.cwd())
})

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

describe('backlog_gate_scope.gate_scope', () => {
	it("reads a running lane's recorded plan in place of the paths its body declares", async () => {
		const scope = await backlog_gate_scope.gate_scope(CONTEXT)

		expect([...(scope.declared.get(RUNNING) ?? [])]).toStrictEqual([PLANNED_FILE])
	})

	it('names the issue whose lane yielded on a kept plan, and no other', async () => {
		lane_plan.record(
			{ issue: YIELDED, paths: [PLANNED_FILE], planned_at: PLANNED_AT, yielded: true },
			process.cwd(),
		)

		const scope = await backlog_gate_scope.gate_scope(CONTEXT)

		expect([...(scope.yielded ?? [])]).toStrictEqual([
			epic_graph.key_of({ number: YIELDED, repo: REPO }),
		])
	})
})
