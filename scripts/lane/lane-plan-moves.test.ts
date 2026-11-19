import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import type { LanePlan } from './lane-plan'
import { lane_plan_moves } from './lane-plan-moves'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#8119: #7980 declared 6 files / 250 lines, moved `tools/test/test-symbol-*` to
// `scripts/test/` and shipped 1,904 lines; the lines axis never read the moved lines, so the plan
// started within the cap.

const ISSUE = 7980
const PLANNED_AT = '2026-11-18T00:00:00.000Z'
const DECLARED_FILES = 6
const DECLARED_LINES = 250
const SOURCE = 'tools/test/test-symbol-users.ts'
const DESTINATION = 'scripts/test/test-symbol-users.ts'
const SOURCE_LINES = 300
const MOVED = SOURCE_LINES * 2
const SMALL_LINES = 40
const EDITED_SKILL = '.claude/skills/a/SKILL.md'
const OTHERS = ['scripts/test/a.ts', 'scripts/test/b.ts', 'scripts/test/c.ts', 'docs/d.md']
const BASE = [SOURCE, ...OTHERS]
const MOVE_PLAN = [...BASE, DESTINATION]
const UNREAD: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	base_files: new Set(BASE),
	lines_ratio: 1,
	implement_rate: undefined,
	split_filed: false,
}
const SIGNALS: PlanSignals = { ...UNREAD, moved_source_lines: new Map([[SOURCE, SOURCE_LINES]]) }

function declared(lines: number): Array<OpenIssueData> {
	const body = `## 背景\n\n- 規模見積もり: 約 ${String(DECLARED_FILES)} ファイル / ${String(lines)} 行（テスト除く）\n`

	return [{ number: ISSUE, title: 'lane', createdAt: PLANNED_AT, labels: [], body }]
}

function plan_of(paths: Array<string>): LanePlan {
	return { issue: ISSUE, paths, planned_at: PLANNED_AT }
}

function oversize_of(
	paths: Array<string>,
	signals = SIGNALS,
	lines = DECLARED_LINES,
): Oversize | undefined {
	return lane_plan_size.oversize(plan_of(paths), declared(lines), undefined, signals)
}

function is_past_cap(paths: Array<string>, signals = SIGNALS): boolean {
	const over = oversize_of(paths, signals)

	return over !== undefined && lane_plan_size.is_past_cap(plan_of(paths), over)
}

describe('lane_plan_moves.sources_of', () => {
	it('reads a listed path and an unlisted one sharing a file name as a move', () => {
		expect(lane_plan_moves.sources_of(MOVE_PLAN, new Set(BASE))).toStrictEqual([SOURCE])
	})

	it.each([
		['no unlisted namesake', BASE, new Set(BASE)],
		['a directory claim', [SOURCE, 'scripts/test/'], new Set(BASE)],
		['no base listing', MOVE_PLAN, undefined],
		[
			'an edited SKILL.md beside an added one',
			[EDITED_SKILL, '.claude/skills/b/SKILL.md'],
			new Set([EDITED_SKILL]),
		],
		[
			'two listed namesakes for one unlisted one',
			['a/x.ts', 'b/x.ts', 'c/x.ts'],
			new Set(['a/x.ts', 'b/x.ts']),
		],
	])('reads no move with %s', (_case, paths, base) => {
		expect(lane_plan_moves.sources_of(paths, base)).toStrictEqual([])
	})

	it('counts each source twice and an unread one as nothing', () => {
		const lines = new Map([[SOURCE, SOURCE_LINES]])

		expect(lane_plan_moves.moved_lines([SOURCE, 'tools/x.ts'], lines)).toBe(MOVED)
	})
})

describe('lane_plan_size.oversize with a planned move', () => {
	it('stays within the cap for the #7980 shape with the moved lines unread, as before', () => {
		expect(is_past_cap(MOVE_PLAN, UNREAD)).toBe(false)
	})

	it('answers lines past the cap for the #7980 shape once the moved lines count', () => {
		expect(oversize_of(MOVE_PLAN)).toMatchObject({
			reason: 'lines',
			measured: DECLARED_LINES + MOVED,
			moved: MOVED,
		})
		expect(is_past_cap(MOVE_PLAN)).toBe(true)
	})

	it('names the moved lines in the refusal', () => {
		const over = oversize_of(MOVE_PLAN)

		expect(over && lane_plan_size.refusal_text(ISSUE, over)).toContain(
			'its planned moves add 600 (2 times the lines moved)',
		)
	})

	it('answers a move alone past a declaration within the bar', () => {
		expect(oversize_of([SOURCE, DESTINATION], SIGNALS, SMALL_LINES)).toMatchObject({
			reason: 'lines',
			moved: MOVED,
		})
	})

	it('passes the same small declaration with no move, as before', () => {
		expect(oversize_of(BASE, SIGNALS, SMALL_LINES)).toBeUndefined()
	})
})
