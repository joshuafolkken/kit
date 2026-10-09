import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_rank } from './backlog-rank'
import { backlog_restructure } from './backlog-restructure'

// joshuafolkken/kit#3221: two lanes that both restructure one file meet a conflict git cannot
// resolve, so the offer holds the second back; two that merely touch one file are still offered.

const { REPO } = backlog_fixture
const FIRST = 3301
const SECOND = 3302
const THIRD = 3303
const RUNNING = 3304
const MOVED = 'scripts/run/ship/run-ship.ts'
const IDLE: BusyRead = { kind: 'idle' }

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function busy(number: number): BusyRead {
	return {
		kind: 'busy',
		issues: [{ number, title: 'running', createdAt: '2026-10-05T00:00:00Z', blockedBy: undefined }],
	}
}

function separate(
	bodies: ReadonlyArray<[number, string]>,
	read: BusyRead = IDLE,
): ReturnType<typeof backlog_restructure.separate> {
	const declared = backlog_restructure.declared_of(
		bodies.map(([number, body]) => ({ number, body })),
	)
	const offered = [FIRST, SECOND, THIRD].map((number) => child(number))

	return backlog_restructure.separate({ offered, withheld: [] }, declared, { read, repo: REPO })
}

function numbers(children: ReadonlyArray<EpicChild>): Array<number> {
	return children.map((entry) => entry.number)
}

describe('backlog_restructure.restructured_paths', () => {
	it('reads the backticked paths on a line that moves, splits, renames or deletes', () => {
		const body = [
			`- Move \`${MOVED}\` into a new module`,
			'- 分割: `scripts/a/b.ts:42` を二つに',
			'- Rename `old-name.ts`',
			'- Update `scripts/other.ts` only',
		].join('\n')

		expect(backlog_restructure.restructured_paths(body)).toStrictEqual(
			new Set([MOVED, 'scripts/a/b.ts', 'old-name.ts']),
		)
	})

	it('does not count a line that only removes something', () => {
		expect(backlog_restructure.restructured_paths(`- Remove \`${MOVED}\``).size).toBe(0)
	})

	it('ignores a backticked token that is not a path', () => {
		expect(backlog_restructure.restructured_paths('- Move `run_ship` aside').size).toBe(0)
	})
})

describe('backlog_restructure.separate', () => {
	it('offers only the first of two candidates that both move one file', () => {
		const selection = separate([
			[FIRST, `Move \`${MOVED}\``],
			[SECOND, `Split \`${MOVED}\` in two`],
		])

		expect(numbers(selection.offered)).toStrictEqual([FIRST, THIRD])
		expect(numbers(selection.withheld)).toStrictEqual([SECOND])
		expect(selection.notice).toBe(
			`${session_cite.issue(SECOND)} waits: it and ${session_cite.issue(FIRST)} both restructure \`${MOVED}\`.`,
		)
	})

	it('offers both candidates when they merely touch one file', () => {
		const selection = separate([
			[FIRST, `Update \`${MOVED}\``],
			[SECOND, `Fix a typo in \`${MOVED}\``],
		])

		expect(numbers(selection.offered)).toStrictEqual([FIRST, SECOND, THIRD])
		expect(selection.notice).toBeUndefined()
	})

	it('withholds a candidate that restructures what a running lane restructures', () => {
		const selection = separate(
			[
				[RUNNING, `Delete \`${MOVED}\``],
				[FIRST, `Move \`${MOVED}\``],
			],
			busy(RUNNING),
		)

		expect(numbers(selection.offered)).toStrictEqual([SECOND, THIRD])
		expect(selection.notice).toContain(`#${String(RUNNING)}`)
	})
})

describe('backlog_rank.select — the restructure separation', () => {
	it('applies the separation to what it offers', () => {
		const candidates = [child(FIRST), child(SECOND)]
		const declared = backlog_restructure.declared_of([
			{ number: FIRST, body: `Move \`${MOVED}\`` },
			{ number: SECOND, body: `Rename \`${MOVED}\`` },
		])
		const selection = backlog_rank.select({
			candidates,
			pool: candidates,
			read: IDLE,
			repo: REPO,
			standalone: new Set(),
			declared,
		})

		expect(numbers(selection.offered)).toStrictEqual([FIRST])
	})
})
