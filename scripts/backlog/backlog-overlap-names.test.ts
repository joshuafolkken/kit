import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'

// joshuafolkken/kit#8273: a body that names `run-board-render.ts` with no directory launched beside the
// lane planning `scripts/run/board/run-board-render.ts`, and the lane returned it after launch.

const { REPO } = backlog_fixture
const RUNNING = 8247
const WAITING = 8257
const NAME = 'run-board-render.ts'
const PLANNED = `scripts/run/board/${NAME}`
const ROOT_FILE = 'package.json'
const TRACKED = [PLANNED, ROOT_FILE, `templates/${ROOT_FILE}`, 'a/b/twin.ts', 'c/d/twin.ts']

const BUSY: BusyRead = {
	kind: 'busy',
	issues: [
		{ number: RUNNING, title: 'running', createdAt: '2026-11-19T17:00:00Z', blockedBy: undefined },
	],
}

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function resolved(body: string): ReadonlySet<string> {
	const declared = backlog_overlap.declared_of([{ number: WAITING, body }])

	return backlog_overlap.with_resolved_names(declared, TRACKED).get(WAITING) ?? new Set()
}

describe('backlog_overlap.with_resolved_names', () => {
	it('withholds a candidate whose bare name is the one tracked file a running lane plans', () => {
		const declared = backlog_overlap.with_resolved_names(
			backlog_overlap.declared_of([{ number: WAITING, body: `Fix \`${NAME}\`` }]),
			TRACKED,
		)
		const claims = new Map([...declared, [RUNNING, new Set([PLANNED])]])
		const context = { read: BUSY, repo: REPO }
		const selection = backlog_overlap.separate(
			{ offered: [child(WAITING)], withheld: [] },
			claims,
			context,
		)

		expect(selection.withheld.map((entry) => entry.number)).toStrictEqual([WAITING])
	})

	it('keeps a bare name two tracked files share as it was', () => {
		expect(resolved('`twin.ts`')).toStrictEqual(new Set(['twin.ts']))
	})

	it('keeps a root file as the root file, even beside a nested one of its name', () => {
		expect(resolved(`\`${ROOT_FILE}\``)).toStrictEqual(new Set([ROOT_FILE]))
	})

	it('claims no path for a dotted code identifier', () => {
		expect(resolved('`session_cite.issue` and `process.env`').size).toBe(0)
	})

	it('leaves a declared path as it was when no tracked file shares its name', () => {
		expect(resolved(`\`untracked.ts\` and \`${PLANNED}\``)).toStrictEqual(
			new Set(['untracked.ts', PLANNED]),
		)
		expect(backlog_overlap.with_resolved_names(new Map(), TRACKED).size).toBe(0)
	})
})
