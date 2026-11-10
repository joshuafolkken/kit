import { describe, expect, it } from 'vitest'
import { run_park_body } from './run-park-body'

const OWNER_PERMISSION = '   - 必要な権限: owner コメント'
const PARENT_PERMISSION = '   - 必要な権限: 親セッション'
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

	it("notes a recommendation needing the parent's own action (ac-ec188a74)", () => {
		const body = body_with(
			PICK_ONE,
			OPTIONS.replace(OWNER_PERMISSION, () => PARENT_PERMISSION),
		)

		expect(run_park_body.summary_of(body)).toBe('推奨: 1（層 A · 親の操作）')
	})
})

// joshuafolkken/kit#6777: the pick `backlog:triage --pass` prints an `--adopt` line for.
describe('run_park_body.adoptable_pick', () => {
	it('answers a tier A recommendation', () => {
		expect(run_park_body.adoptable_pick(body_with(PICK_ONE))).toBe(1)
	})

	it.each([
		['a tier C recommendation', PICK_TWO],
		['a park saying none', NO_PICK],
	])('answers no pick for %s', (_case, pick) => {
		expect(run_park_body.adoptable_pick(body_with(pick))).toBeUndefined()
	})
})

function single_option(tier: string, permission: string): string {
	return body_with(
		PICK_ONE,
		['### 選択肢', '1. File it', `   - 層: ${tier}`, `   - 必要な権限: ${permission}`].join('\n'),
	)
}

// joshuafolkken/kit#7001: an option needing the parent's own action is taken before the lane resumes.
describe('run_park_body.parent_action', () => {
	it.each([
		['親', true],
		['親セッション', true],
		['なし', false],
		['人', false],
	])('answers %j as %j', (permission, expected) => {
		expect(run_park_body.parent_action(single_option('A', permission), 1)).toBe(expected)
	})
})

// joshuafolkken/kit#6738: a park whose recommendation needs no person is the parent's to take.
describe('run_park_body.auto_pick', () => {
	it('picks the recommendation for tier A needing no permission', () => {
		expect(run_park_body.auto_pick(single_option('A', 'なし'))).toBe(1)
	})

	it.each([
		["tier A needing the parent's own action", 'A', '親'],
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

// joshuafolkken/kit#6670: the option `backlog:triage --adopt` may take, refused before any write.
describe('run_park_body.adopt_problem', () => {
	it.each([
		['the recommended tier A option', PICK_ONE, 1],
		['another tier A option beside a recommendation', PICK_TWO, 1],
	])('lets a parent adopt %s', (_case, pick, option) => {
		expect(run_park_body.adopt_problem(body_with(pick), option)).toBeUndefined()
	})

	it.each([
		['a park with no recommendation (ac-77bc914f)', NO_PICK, 1, 'the park says 推奨なし'],
		['an unlisted option (ac-77bc914f)', PICK_ONE, 3, '### 選択肢 lists no option 3'],
		['a tier C option (ac-77bc914f)', PICK_TWO, 2, 'option 2 is tier C'],
	])('refuses %s', (_case, pick, option, problem) => {
		expect(run_park_body.adopt_problem(body_with(pick), option)).toContain(problem)
	})
})

// joshuafolkken/kit#6776: a size-approval option carries the paths and both axes of the json
// `backlog:triage --adopt` writes for it.
const FIRST_PATH = 'scripts/a.ts'
const APPROVAL_PATHS = `   - 規模承認のパス: \`${FIRST_PATH}\`, \`docs/b.md\``
const APPROVAL_LINES = '   - 規模承認の行数: 150 / 260'
const APPROVAL_FILES = '   - 規模承認のファイル数: 4/6'
const APPROVAL = [APPROVAL_PATHS, APPROVAL_LINES, APPROVAL_FILES]
const LINES_FORMAT = '- 規模承認の行数: <declared> / <max>'

function approval_body(range: ReadonlyArray<string>): string {
	return body_with(PICK_ONE, ['### 選択肢', ...OPTION_ONE, ...range, ...OPTION_TWO].join('\n'))
}

describe('run_park_body size-approval options', () => {
	it('accepts an option with its whole range and reads it back', () => {
		const body = approval_body(APPROVAL)

		expect(run_park_body.problem_of(body)).toBeUndefined()
		expect(run_park_body.approval_range(body, 1)).toStrictEqual({
			paths: [FIRST_PATH, 'docs/b.md'],
			lines: { declared: 150, max: 260 },
			files: { declared: 4, max: 6 },
		})
	})

	it.each([
		['paths (ac-1a33e298)', APPROVAL_PATHS, '- 規模承認のパス: <path> …'],
		['the line axis (ac-1a33e298)', APPROVAL_LINES, LINES_FORMAT],
		['the file axis (ac-1a33e298)', APPROVAL_FILES, '- 規模承認のファイル数: <declared> / <max>'],
	])('refuses a range missing %s', (_case, missing, line) => {
		const body = approval_body(APPROVAL.filter((part) => part !== missing))

		expect(run_park_body.problem_of(body)).toBe(`option 1 has no "${line}" line`)
		expect(run_park_body.approval_range(body, 1)).toBeUndefined()
	})

	it('prints the three range lines in the schema it refuses with', () => {
		expect(run_park_body.FORMAT).toContain(`   ${LINES_FORMAT}`)
		expect(run_park_body.FORMAT).toContain('   (a size-approval option adds all three:)')
	})

	it('reads no range from an option that is no size approval', () => {
		expect(run_park_body.approval_range(approval_body(APPROVAL), 2)).toBeUndefined()
	})
})

// The approval json's schema refuses an empty path and a zero bound, so the park refuses them first.
describe('run_park_body size-approval values', () => {
	it.each([
		['a trailing separator', `   - 規模承認のパス: \`${FIRST_PATH}\`,`, [FIRST_PATH]],
		['backticks only', '   - 規模承認のパス: ``', undefined],
	])('reads no empty path from %s', (_case, line, paths) => {
		const range = run_park_body.approval_range(approval_body([line, ...APPROVAL.slice(1)]), 1)

		expect(range?.paths).toStrictEqual(paths)
	})

	it.each([
		['a zero declared bound', '   - 規模承認の行数: 0 / 260'],
		['a zero max bound', '   - 規模承認の行数: 150 / 0'],
		['a leading zero', '   - 規模承認の行数: 0150 / 260'],
	])('refuses a line axis with %s', (_case, line) => {
		const body = approval_body([APPROVAL_PATHS, line, APPROVAL_FILES])

		expect(run_park_body.problem_of(body)).toBe(`option 1 has no "${LINES_FORMAT}" line`)
	})
})

function option_lines(number: number, tier: string, permission: string): ReadonlyArray<string> {
	return [
		`${String(number)}. Option ${String(number)}`,
		`   - 層: ${tier}`,
		`   - 必要な権限: ${permission}`,
	]
}

function unpicked(...options: ReadonlyArray<ReadonlyArray<string>>): string {
	return body_with(NO_PICK, ['### 選択肢', ...options.flat()].join('\n'))
}

// joshuafolkken/kit#7077: a park with no recommendation is decided by a default rule — the first
// listed reversible option with the smallest change — and never when only a person may take one.
describe('run_park_body.default_pick', () => {
	it('takes the first reversible option needing no permission, over the rest', () => {
		const body = unpicked(
			option_lines(1, 'A', '人'),
			option_lines(2, 'B', 'なし'),
			option_lines(3, 'A', 'なし'),
		)

		expect(run_park_body.default_pick(body)).toStrictEqual({ number: 2, over: [1, 3] })
	})

	it('passes over an option carrying a size approval, which widens the change', () => {
		const body = unpicked(
			[...option_lines(1, 'A', 'なし'), ...APPROVAL],
			option_lines(2, 'B', 'なし'),
		)

		expect(run_park_body.default_pick(body)).toStrictEqual({ number: 2, over: [1] })
	})

	it.each([
		['only tier C options', unpicked(option_lines(1, 'C', 'なし'), option_lines(2, 'C', '人'))],
		["only the parent's own action", unpicked(option_lines(1, 'A', '親'))],
		['a recommendation', single_option('A', 'なし')],
		['an off-schema body', OFF_SCHEMA],
	])('leaves a park with %s undecided', (_case, body) => {
		expect(run_park_body.default_pick(body)).toBeUndefined()
	})
})
