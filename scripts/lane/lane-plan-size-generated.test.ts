import { codex_hooks } from '#scripts/agent/codex-hooks'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { describe, expect, it } from 'vitest'
import { lane_plan_size, type Oversize, type PlanSignals } from './lane-plan-size'

// joshuafolkken/kit#6666: a plan editing `.claude/settings.json` must regenerate `.codex/hooks.json` in the
// same change, so the files axis counts the artifact with its source rather than as one more file.

const ISSUE = 6666
const PLANNED_AT = '2026-11-10T00:00:00.000Z'
const DECLARED_FILES = 2
const LIMIT = 4
const SOURCE = codex_hooks.CLAUDE_SETTINGS_FILE
const ARTIFACT = codex_hooks.CODEX_HOOKS_FILE
const ISSUES: Array<OpenIssueData> = [
	{
		number: ISSUE,
		title: 'lane',
		createdAt: PLANNED_AT,
		labels: [],
		body: `## 背景\n\n- 規模見積もり: 約 ${String(DECLARED_FILES)} ファイル / 25 行（テスト除く）\n`,
	},
]
const QUIET: PlanSignals = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}

function files(count: number): Array<string> {
	return Array.from({ length: count }, (_, index) => `scripts/hooks/file-${String(index + 1)}.ts`)
}

function oversize_of(paths: ReadonlyArray<string>): Oversize | undefined {
	return lane_plan_size.oversize(
		{ issue: ISSUE, paths: [...paths], planned_at: PLANNED_AT },
		ISSUES,
		undefined,
		QUIET,
	)
}

describe('lane_plan_size.oversize on generated artifacts', () => {
	it('maps the Codex hooks artifact to the Claude settings it is generated from', () => {
		expect(codex_hooks.GENERATED_SOURCES.get(ARTIFACT)).toBe(SOURCE)
	})

	it('does not count the artifact planned beside its source', () => {
		expect(oversize_of([...files(LIMIT - 1), SOURCE, ARTIFACT])).toBeUndefined()
	})

	it('splits the artifact off with its source', () => {
		expect(oversize_of([...files(LIMIT), SOURCE, ARTIFACT])).toMatchObject({
			reason: 'files',
			kept: files(LIMIT),
			split_off: [SOURCE, ARTIFACT],
		})
	})

	it('keeps the artifact with its kept source and leaves it out of the refusal count', () => {
		const over = oversize_of([SOURCE, ...files(LIMIT), ARTIFACT])

		expect(over).toMatchObject({ kept: [SOURCE, ...files(LIMIT - 1), ARTIFACT] })
		expect(over === undefined ? '' : lane_plan_size.refusal_text(ISSUE, over)).toContain(
			`holds ${String(LIMIT + 1)} files`,
		)
	})

	it('counts the artifact planned without its source', () => {
		expect(oversize_of([...files(LIMIT), ARTIFACT])).toMatchObject({
			reason: 'files',
			split_off: [ARTIFACT],
		})
	})

	it('counts files as before when the plan holds no generated artifact', () => {
		expect(oversize_of(files(LIMIT))).toBeUndefined()
		expect(oversize_of(files(LIMIT + 1))).toMatchObject({ reason: 'files', limit: LIMIT })
	})
})
