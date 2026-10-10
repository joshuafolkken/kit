import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'
import { backlog_rank } from './backlog-rank'

// joshuafolkken/kit#3617: two lanes whose bodies declare overlapping paths met a conflict the merge
// of main could not resolve, so the offer holds the second back; lanes on separate directories
// still run side by side.

const { REPO } = backlog_fixture
const FIRST = 3301
const SECOND = 3302
const THIRD = 3303
const RUNNING = 3304
const SHARED = 'scripts/run/ship/run-ship.ts'
const IDLE: BusyRead = { kind: 'idle' }

// The paths joshuafolkken/kit#3582 and joshuafolkken/kit#3586 declared, abridged.
const LIMITS_BODY = [
	'- `scripts/lines/effective-limit.ts` と `scripts/metrics/metrics-ratchet.ts` を直す',
	'- 対象は `scripts/` の外に出ない（`joshuafolkken/kit#N`）',
].join('\n')
const LINT_BODY =
	'- `scripts/lines/**`、`scripts/metrics/**`、`scripts/lint/**` を `scripts/` の中で直す'
// joshuafolkken/kit#3583 and joshuafolkken/kit#3584 each declared directories of their own.
const RUN_BODY = '- `scripts/run/**` を直す（`scripts/`、`joshuafolkken/kit#N`）'
const BACKLOG_BODY = '- `scripts/backlog/**` と `scripts/epic/**` を直す（`scripts/`）'

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
): ReturnType<typeof backlog_overlap.separate> {
	const declared = backlog_overlap.declared_of(bodies.map(([number, body]) => ({ number, body })))
	const offered = [FIRST, SECOND, THIRD].map((number) => child(number))

	return backlog_overlap.separate({ offered, withheld: [] }, declared, { read, repo: REPO })
}

function numbers(children: ReadonlyArray<EpicChild>): Array<number> {
	return children.map((entry) => entry.number)
}

describe('backlog_overlap.declared_paths', () => {
	it('reads every backticked file, with or without a restructuring verb', () => {
		const body = [
			`- Update \`${SHARED}\``,
			'- 分割: `scripts/a/b.ts:42` を二つに',
			'- `old-name.ts`',
		].join('\n')

		expect(backlog_overlap.declared_paths(body)).toStrictEqual(
			new Set([SHARED, 'scripts/a/b.ts', 'old-name.ts']),
		)
	})

	it('reads a file cited with a line range as the file', () => {
		const body = '`scripts/gate/gate-skip.ts:71-85` and `scripts/run/ship/run-ship-steps.ts:3:7`'

		expect(backlog_overlap.declared_paths(body)).toStrictEqual(
			new Set(['scripts/gate/gate-skip.ts', 'scripts/run/ship/run-ship-steps.ts']),
		)
	})

	it('reads a directory glob as the directory it names', () => {
		const body = '`scripts/lines/**`, `scripts/metrics/*.ts` and `.github/workflows/`'

		expect(backlog_overlap.declared_paths(body)).toStrictEqual(
			new Set(['scripts/lines/', 'scripts/metrics/', '.github/workflows/']),
		)
	})

	it('drops a directory one segment deep and an issue reference', () => {
		const body = '`scripts/`, `scripts/**`, `docs/*.md`, `*.ts` and `joshuafolkken/kit#3221`'

		expect(backlog_overlap.declared_paths(body).size).toBe(0)
	})

	it('ignores a backticked token that is not a path', () => {
		expect(backlog_overlap.declared_paths('- `run_ship` and `owner/repo`').size).toBe(0)
	})
})

describe('backlog_overlap.declared_paths — tokens with no directory', () => {
	it('ignores a dotted code identifier but reads a root-level file', () => {
		const body = '`session_cite.issue`, `process.env`, `vi.fn`, `package.json` and `CLAUDE.md`'

		expect(backlog_overlap.declared_paths(body)).toStrictEqual(
			new Set(['package.json', 'CLAUDE.md']),
		)
	})
})

describe('backlog_overlap.separate', () => {
	it('offers only the first of two candidates that name one file', () => {
		const selection = separate([
			[FIRST, `Update \`${SHARED}\``],
			[SECOND, `Fix a typo in \`${SHARED}\``],
		])

		expect(numbers(selection.offered)).toStrictEqual([FIRST, THIRD])
		expect(numbers(selection.withheld)).toStrictEqual([SECOND])
		expect(selection.notice).toBe(
			`${session_cite.issue(SECOND)} waits: its \`${SHARED}\` overlaps \`${SHARED}\`, which ${session_cite.issue(FIRST)} declares.`,
		)
	})

	it('holds back the directory glob that covers a file an earlier candidate names', () => {
		const selection = separate([
			[FIRST, LIMITS_BODY],
			[SECOND, LINT_BODY],
		])

		expect(numbers(selection.offered)).toStrictEqual([FIRST, THIRD])
		expect(selection.notice).toContain('overlaps `scripts/lines/effective-limit.ts`')
	})
})

describe('backlog_overlap.separate — separate directories and running lanes', () => {
	it('offers candidates that declare separate directories side by side', () => {
		const selection = separate([
			[FIRST, RUN_BODY],
			[SECOND, BACKLOG_BODY],
			[THIRD, LINT_BODY],
		])

		expect(numbers(selection.offered)).toStrictEqual([FIRST, SECOND, THIRD])
		expect(selection.notice).toBeUndefined()
	})

	it('withholds a candidate whose file sits inside a directory a running lane declares', () => {
		const selection = separate(
			[
				[RUNNING, LINT_BODY],
				[FIRST, LIMITS_BODY],
			],
			busy(RUNNING),
		)

		expect(numbers(selection.offered)).toStrictEqual([SECOND, THIRD])
		expect(selection.notice).toContain(`#${String(RUNNING)}`)
	})
})

describe('backlog_rank.select — the overlap separation', () => {
	it('applies the separation to what it offers', () => {
		const candidates = [child(FIRST), child(SECOND)]
		const declared = backlog_overlap.declared_of([
			{ number: FIRST, body: LIMITS_BODY },
			{ number: SECOND, body: LINT_BODY },
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
