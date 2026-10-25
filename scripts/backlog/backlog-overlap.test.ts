import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import type { LaneRecords, LaneStateRecord } from '#scripts/lane/lane-state'
import { figure_format } from '#scripts/lib/figure-format'
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
// The directory the glob `scripts/lines/**` names.
const LINES_DIRECTORY = 'scripts/lines/'
const RUN_DIRECTORY = 'scripts/run/'

// The paths joshuafolkken/kit#3582 and joshuafolkken/kit#3586 declared, abridged.
const LIMITS_BODY = [
	'- `scripts/lines/effective-limit.ts` と `tools/metrics/metrics-ratchet.ts` を直す',
	'- 対象は `scripts/` の外に出ない（`joshuafolkken/kit#N`）',
].join('\n')
const LINT_BODY =
	'- `scripts/lines/**`、`tools/metrics/**`、`scripts/lint/**` を `scripts/` の中で直す'
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
		const body = '`scripts/lines/**`, `tools/metrics/*.ts` and `.github/workflows/`'

		expect(backlog_overlap.declared_paths(body)).toStrictEqual(
			new Set([LINES_DIRECTORY, 'tools/metrics/', '.github/workflows/']),
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

describe('backlog_overlap.path_clash', () => {
	it('names the holder whose declared directory covers a planned file', () => {
		const planned = backlog_overlap.path_claims([SHARED, `joshuafolkken/kit#${String(FIRST)}`])
		const declared = new Map([[RUNNING, new Set([RUN_DIRECTORY])]])

		expect(backlog_overlap.path_clash(planned, declared, [RUNNING])).toStrictEqual({
			path: SHARED,
			claimed: RUN_DIRECTORY,
			holder: RUNNING,
		})
		expect(backlog_overlap.path_clash(planned, declared, [])).toBeUndefined()
	})
})

// joshuafolkken/kit#4926: joshuafolkken/kit#4916 waited 27 minutes on joshuafolkken/kit#4910 for
// `docs/josh-commands-run.md` alone, an overlap the lane's sync with main resolves.
describe('backlog_overlap — a document under docs/', () => {
	it('holds no candidate back on a docs Markdown file or directory both declare', () => {
		const selection = separate([
			[FIRST, '- `docs/josh-commands-run.md` と `scripts/a/one.ts`'],
			[SECOND, '- `docs/josh-commands-run.md` と `docs/how-to/**` と `scripts/b/two.ts`'],
			[THIRD, '- `docs/how-to/run-issues.md`'],
		])

		expect(numbers(selection.offered)).toStrictEqual([FIRST, SECOND, THIRD])
	})

	it('still holds a candidate back on a code file both declare beside the document', () => {
		const selection = separate([
			[FIRST, `- \`docs/josh-commands-run.md\` と \`${SHARED}\``],
			[SECOND, `- \`docs/josh-commands-run.md\` と \`${SHARED}\``],
		])

		expect(numbers(selection.withheld)).toStrictEqual([SECOND])
	})

	it('still counts a rule document outside docs/', () => {
		const rule = 'prompts/review.md'
		const declared = new Map([[RUNNING, new Set([rule])]])

		expect(backlog_overlap.path_clash(new Set([rule]), declared, [RUNNING])?.path).toBe(rule)
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

// joshuafolkken/kit#4270: lanes `lane:pause --all` stopped held five issues back for 1 h 40 min with
// no word of why.
const PAUSED_AT = '2026-10-20T01:28:00.000Z'

function holder_lane(state: LaneStateRecord['state'], changed_by: string): LaneRecords {
	const issue = String(RUNNING)

	return new Map([[issue, { issue, state, changed_at: PAUSED_AT, changed_by }]])
}

// The notice for FIRST, whose file sits inside the directory the running RUNNING declares.
function notice_beside(lanes: LaneRecords): string | undefined {
	const candidates = [child(FIRST)]
	const declared = backlog_overlap.declared_of([
		{ number: RUNNING, body: LINT_BODY },
		{ number: FIRST, body: LIMITS_BODY },
	])
	const input = { candidates, pool: candidates, read: busy(RUNNING), repo: REPO }

	return backlog_rank.select({ ...input, standalone: new Set(), declared, lanes }).notice
}

describe('backlog_rank.select — a paused holder', () => {
	it('names the holder as paused, with when and by what, in the wait it causes', () => {
		const since = figure_format.minute_of(Date.parse(PAUSED_AT))

		expect(notice_beside(holder_lane('paused', 'lane:pause'))).toMatch(
			new RegExp(String.raw`declares — paused since ${since} by lane:pause\.$`, 'u'),
		)
	})

	it('names nothing more for a holder whose lane is running', () => {
		expect(notice_beside(holder_lane('running', 'lane:dispatch'))).toMatch(/declares\.$/u)
	})
})

// joshuafolkken/kit#3750: `run:board` names the running issues itself and asks for the same clash.
describe('backlog_overlap.running_clash', () => {
	const DECLARED = backlog_overlap.declared_of([
		{ number: RUNNING, body: LINT_BODY },
		{ number: FIRST, body: LIMITS_BODY },
		{ number: SECOND, body: RUN_BODY },
	])
	const HOLDING = { holders: [RUNNING], repo: REPO }

	it('answers the path a candidate declares inside what a running issue declares', () => {
		expect(backlog_overlap.running_clash(child(FIRST), DECLARED, HOLDING)).toStrictEqual({
			path: 'scripts/lines/effective-limit.ts',
			claimed: LINES_DIRECTORY,
			holder: RUNNING,
		})
	})

	it('answers none for a candidate on a directory of its own, or with nothing running', () => {
		const idle = { holders: [], repo: REPO }

		expect(backlog_overlap.running_clash(child(SECOND), DECLARED, HOLDING)).toBeUndefined()
		expect(backlog_overlap.running_clash(child(FIRST), DECLARED, idle)).toBeUndefined()
	})

	it('answers none for a candidate in another repository', () => {
		const elsewhere = { ...child(FIRST), repo: 'joshuafolkken/other' }

		expect(backlog_overlap.running_clash(elsewhere, DECLARED, HOLDING)).toBeUndefined()
	})
})
