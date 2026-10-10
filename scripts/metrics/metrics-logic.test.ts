import { describe, expect, it } from 'vitest'
import { metrics_logic, type Metrics, type ScriptFile } from './metrics-logic'

const SCRIPT_WITH_COMMENTS: ScriptFile = {
	text: '// header\n\nconst a = 1 // trailing\n/* block */\nconst b = 2\n',
	code_lines: 2,
}
const SCRIPT_WITHOUT_COMMENTS: ScriptFile = { text: 'const c = 3\n\n', code_lines: 1 }

const FIXTURE_METRICS: Metrics = {
	scripts: { files: 2, code_lines: 3, comment_lines: 2, comment_ratio: 0.67 },
	rules: { files: 2, lines: 5 },
	guards: 2,
	ai_cost: { resident_bytes: 120, on_demand_bytes: 4000 },
}
// The default session language prints nothing (joshuafolkken/kit#3398).
const PER_TURN_HOOK_BYTES = 0

describe('metrics_logic.is_measured_script', () => {
	it('measures a non-test file under scripts/', () => {
		expect(metrics_logic.is_measured_script('scripts/lines/line-budget.ts')).toBe(true)
	})

	it('excludes test files and files outside scripts/', () => {
		expect(metrics_logic.is_measured_script('scripts/lines/line-budget.test.ts')).toBe(false)
		expect(metrics_logic.is_measured_script('eslint/base.js')).toBe(false)
	})
})

describe('metrics_logic.physical_lines', () => {
	it('counts lines as wc -l does', () => {
		expect(metrics_logic.physical_lines('a\nb\n')).toBe(2)
		expect(metrics_logic.physical_lines('a\nb')).toBe(2)
		expect(metrics_logic.physical_lines('')).toBe(0)
	})
})

describe('metrics_logic.script_totals', () => {
	it('derives comment lines as the non-blank lines eslint did not count as code', () => {
		const totals = metrics_logic.script_totals([SCRIPT_WITH_COMMENTS, SCRIPT_WITHOUT_COMMENTS])

		expect(totals).toStrictEqual(FIXTURE_METRICS.scripts)
	})

	it('reports a zero ratio when there is no code', () => {
		expect(metrics_logic.script_totals([])).toStrictEqual({
			files: 0,
			code_lines: 0,
			comment_lines: 0,
			comment_ratio: 0,
		})
	})
})

describe('metrics_logic.rule_totals', () => {
	it('sums the physical lines of every rule document', () => {
		expect(metrics_logic.rule_totals(['# A\n\nbody\n', '# B\nbody\n'])).toStrictEqual(
			FIXTURE_METRICS.rules,
		)
	})
})

describe('metrics_logic.guard_count', () => {
	it('counts only the commands named as guards', () => {
		expect(metrics_logic.guard_count(['batch:guard', 'run:watcher:guard', 'lines', 'guard'])).toBe(
			2,
		)
	})
})

describe('metrics_logic.ai_cost_totals', () => {
	it('sums the bytes of each part, counting a multi-byte character by its encoding', () => {
		expect(metrics_logic.ai_cost_totals(['ab', '品'], ['abcd', ''])).toStrictEqual({
			resident_bytes: 5 + PER_TURN_HOOK_BYTES,
			on_demand_bytes: 4,
		})
	})

	it('counts no per-turn hook bytes for the default language, which prints no line', () => {
		expect(metrics_logic.ai_cost_totals([], [])).toStrictEqual({
			resident_bytes: PER_TURN_HOOK_BYTES,
			on_demand_bytes: 0,
		})
	})
})

describe('metrics_logic.render', () => {
	it('prints one row per metric', () => {
		expect(metrics_logic.render(FIXTURE_METRICS)).toBe(
			[
				'scripts  2 files · 3 code lines · 2 comment lines · comment ratio 0.67',
				'rules    2 files · 5 lines',
				'guards   2',
				'ai cost  120 resident bytes · 4000 on-demand bytes',
			].join('\n'),
		)
	})
})
