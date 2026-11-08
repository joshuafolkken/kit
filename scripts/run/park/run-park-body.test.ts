import { describe, expect, it } from 'vitest'
import { run_park_body } from './run-park-body'

const OWNER_PERMISSION = '   - 必要な権限: owner コメント'
const TIER_C = '   - 層: C'
const OPTION_ONE = ['1. Keep the account', '   - 層: A', OWNER_PERMISSION]
const OPTION_TWO = ['2. Rotate the account', TIER_C, '   - 必要な権限: 人']
const OPTIONS = ['### 選択肢', ...OPTION_ONE, ...OPTION_TWO].join('\n')
const PICK_TWO = '2 the key leaked'
const PICK_ONE = '1 cheaper'
const NO_PICK = '推奨なし both need the owner'
const PICK_MISSING = '### 推奨 needs one line'
const OFF_SCHEMA = 'Which option?'

function body_with(pick: string, options = OPTIONS): string {
	return `## Which account?\n\n${options}\n\n### 推奨\n${pick}\n`
}

// joshuafolkken/kit#6669: the park body schema — options with tiers and permissions, and a
// recommendation or an explicit none.
describe('run_park_body.problem_of', () => {
	it.each([
		['a recommendation with its reason', PICK_TWO],
		['a recommendation after a colon', '1: cheaper'],
		['no recommendation with its reason', NO_PICK],
	])('accepts %s', (_case, pick) => {
		expect(run_park_body.problem_of(body_with(pick))).toBeUndefined()
	})

	it.each([
		['no options section', `### 推奨\n${PICK_ONE}`, '### 選択肢 lists no numbered option'],
		['no recommendation section', OPTIONS, PICK_MISSING],
		['a recommendation with no reason', body_with('1'), PICK_MISSING],
		['no recommendation with no reason', body_with('推奨なし'), PICK_MISSING],
		['an unlisted option', body_with('3 newer'), 'names option 3, which ### 選択肢 does not list'],
		[
			'an option with no tier',
			body_with(PICK_ONE, OPTIONS.replace(`${TIER_C}\n`, '')),
			'option 2 has no "- 層: A|B|C" line',
		],
		[
			'an option with no permission',
			body_with(PICK_ONE, OPTIONS.replace(`${OWNER_PERMISSION}\n`, '')),
			'option 1 has no "- 必要な権限: …" line',
		],
	])('names %s', (_case, body, problem) => {
		expect(run_park_body.problem_of(body)).toContain(problem)
	})

	it('reads the schema even when a lane note follows it', () => {
		const body = `${body_with(PICK_TWO)}\n---\n- Lane directory: \`/lane\`\n`

		expect(run_park_body.problem_of(body)).toBeUndefined()
	})

	it('ignores a schema inside a code fence', () => {
		expect(run_park_body.problem_of(`\`\`\`md\n${body_with(PICK_ONE)}\`\`\`\n`)).toBeDefined()
	})
})

describe('run_park_body.summary_of', () => {
	it.each([
		[PICK_TWO, '推奨: 2（層 C）'],
		[PICK_ONE, '推奨: 1（層 A）'],
		[NO_PICK, '推奨なし'],
	])('summarizes %j as %j', (pick, summary) => {
		expect(run_park_body.summary_of(body_with(pick))).toBe(summary)
	})

	it('answers undefined for a body off the schema', () => {
		expect(run_park_body.summary_of(OFF_SCHEMA)).toBeUndefined()
	})
})

function single_option(tier: string, permission: string): string {
	return body_with(
		PICK_ONE,
		['### 選択肢', '1. File it', `   - 層: ${tier}`, `   - 必要な権限: ${permission}`].join('\n'),
	)
}

// joshuafolkken/kit#6738: a park whose recommendation needs no person is the parent's to take.
describe('run_park_body.auto_pick', () => {
	it.each([
		['tier A needing no permission', 'A', 'なし'],
		["tier A needing the parent's", 'A', '親'],
	])('picks the recommendation for %s', (_case, tier, permission) => {
		expect(run_park_body.auto_pick(single_option(tier, permission))).toBe(1)
	})

	it.each([
		['tier B needing no permission', 'B', 'なし'],
		['tier A needing a person', 'A', '人'],
		['tier A needing the trust setting', 'A', '信頼設定'],
		['tier A needing an owner comment', 'A', 'owner コメント'],
	])('leaves %s to a person', (_case, tier, permission) => {
		expect(run_park_body.auto_pick(single_option(tier, permission))).toBeUndefined()
	})

	it('lists the permissions a parent takes itself in the schema it prints', () => {
		expect(run_park_body.FORMAT).toContain('必要な権限: なし | 親 |')
	})

	it.each([
		['no recommendation', body_with(NO_PICK)],
		['a body off the schema', OFF_SCHEMA],
	])('picks nothing for %s', (_case, body) => {
		expect(run_park_body.auto_pick(body)).toBeUndefined()
	})
})
