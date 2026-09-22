import { describe, expect, it } from 'vitest'
import { behavior_change_lint } from './behavior-change-lint'

const FIRING_POINT = '`AskUserQuestion`'
const BASELINE_ENTRY = '- `pnpm josh run:wake` → 1.00'
const BASELINE_HEADING = '## ベースライン'
const REPRODUCTION_HEADING = '## 再現'
const REPRODUCTION_COMMAND = '- `grep -c run:watcher:guard .claude/settings.json`'
const REPRODUCTION_OUTPUT = ['~~~', '0', '~~~'].join('\n')

const TARGET_BODY = [
	'## 背景',
	'',
	'- 種別: 振る舞い変更',
	'',
	'なぜ必要か',
	'',
	'## 発火点',
	'',
	FIRING_POINT,
	'',
	BASELINE_HEADING,
	'',
	BASELINE_ENTRY,
	'',
	REPRODUCTION_HEADING,
	'',
	REPRODUCTION_COMMAND,
	'',
	REPRODUCTION_OUTPUT,
].join('\n')

const CODE_ONLY_BODY = ['## 背景', '', '- 種別: コードのみ', '', 'なぜ必要か'].join('\n')

describe('behavior_change_lint.is_target', () => {
	it('reads the declaration line as the target marker', () => {
		expect(behavior_change_lint.is_target(TARGET_BODY)).toBe(true)
	})

	it('treats a code-only Issue as not a target', () => {
		expect(behavior_change_lint.is_target(CODE_ONLY_BODY)).toBe(false)
	})
})

describe('behavior_change_lint.problems', () => {
	it('holds a code-only Issue to none of the two headings', () => {
		expect(behavior_change_lint.problems(CODE_ONLY_BODY)).toEqual([])
	})

	it('accepts a well-formed behavior-change body', () => {
		expect(behavior_change_lint.problems(TARGET_BODY)).toEqual([])
	})

	it('reports a missing heading on a target Issue', () => {
		const without_baseline = TARGET_BODY.split(BASELINE_HEADING, 1)[0] ?? ''

		expect(behavior_change_lint.problems(without_baseline)).toContain(
			'missing heading: ## ベースライン',
		)
	})

	it('rejects a baseline written in prose', () => {
		const prose = TARGET_BODY.replace(BASELINE_ENTRY, 'だいたい 1.00 のままだった')

		expect(behavior_change_lint.problems(prose)).toContain(
			'baseline must be written as `command → value`, not prose (it has to be re-runnable)',
		)
	})

	it('reports a missing reproduction heading on a target Issue', () => {
		const without_reproduction = TARGET_BODY.split(REPRODUCTION_HEADING, 1)[0] ?? ''

		expect(behavior_change_lint.problems(without_reproduction)).toContain(
			'missing heading: ## 再現',
		)
	})

	it('rejects a reproduction written in prose', () => {
		const prose = TARGET_BODY.replace(REPRODUCTION_COMMAND, '確認した').replace(
			REPRODUCTION_OUTPUT,
			'だいたい 0 のままだった',
		)

		expect(behavior_change_lint.problems(prose)).toContain(
			'reproduction must be a command and its actual output (a fenced block), not prose ("確認した" is not re-runnable)',
		)
	})
})

describe('behavior_change_lint.problems — firing point', () => {
	it('flags a firing point that no hook can deliver', () => {
		const undeliverable = TARGET_BODY.replace(FIRING_POINT, '`WebFetch`')

		expect(behavior_change_lint.problems(undeliverable)).toContain(
			'firing point `WebFetch` is a real tool call, but no hook can deliver a rule on it',
		)
	})

	it('flags a firing point that is not a recognized tool call', () => {
		const unknown = TARGET_BODY.replace(FIRING_POINT, '`MadeUpTool`')

		expect(behavior_change_lint.problems(unknown)).toContain(
			'firing point `MadeUpTool` is not on the delivery table (not a recognized tool call)',
		)
	})
})

describe('behavior_change_lint.firing_point_name', () => {
	it('reads a backticked tool name', () => {
		expect(behavior_change_lint.firing_point_name(TARGET_BODY)).toBe('AskUserQuestion')
	})

	it('skips the template placeholder', () => {
		const placeholder = TARGET_BODY.replace(FIRING_POINT, '<ツール名を書く>')

		expect(behavior_change_lint.firing_point_name(placeholder)).toBeUndefined()
	})

	it('reads a bare tool name written as a bullet, not the dash', () => {
		const bulleted = TARGET_BODY.replace(FIRING_POINT, '- Bash')

		expect(behavior_change_lint.firing_point_name(bulleted)).toBe('Bash')
	})
})
