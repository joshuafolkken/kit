import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_code_tree } from '#scripts/review/review-code-tree'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_branches } from './test-pinned-branches'
import { test_pinned_functions } from './test-pinned-functions'
import { test_pinned_logic, type Hunk, type UnpinnedHunk } from './test-pinned-logic'

const FILE = 'scripts/sample.ts'
const THROW = test_pinned_functions.STUB_BODY
const IF_ARM = 'if branch'
const ELSE_ARM = 'else branch'
const TRUE_ARM = '?: true branch'
const FALSE_ARM = '?: false branch'
const NULLISH_ARM = '?? right side'
const INDENTED_THROW = `\t\t${THROW}`
const FIX = 'add a test that takes this branch'
const THEN_LINE = '\tif (a) return 1'
const ONE_IF = 'if (a) f()\n'

function hunk_at(file: string, new_start: number, new_count: number): Hunk {
	return { file, new_start, new_count, old_lines: [] }
}

function arms(content: string, lines?: ReadonlySet<number>): Array<Hunk> {
	return test_pinned_branches.branch_hunks(ts, FILE, content, lines)
}

function names(content: string, lines?: ReadonlySet<number>): Array<string | undefined> {
	return arms(content, lines).map((hunk) => hunk.function_name)
}

function branch(overrides: Partial<UnpinnedHunk>): UnpinnedHunk {
	return { ...hunk_at(FILE, 3, 1), is_branch: true, is_green: true, ...overrides }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_pinned_branches.branch_hunks — if', () => {
	it('makes one probe per if arm, each arm replaced by a throw on its own lines', () => {
		const content = ['function f(a: boolean): number {', THEN_LINE, '\telse return 2', '}'].join(
			'\n',
		)
		const [then_arm, else_arm] = arms(content)

		expect(then_arm).toMatchObject({
			function_name: IF_ARM,
			new_start: 2,
			new_count: 1,
			is_branch: true,
		})
		expect(then_arm?.old_lines).toStrictEqual([`\tif (a) ${THROW}`])
		expect(then_arm?.new_lines).toStrictEqual([THEN_LINE])
		expect(else_arm).toMatchObject({ function_name: ELSE_ARM, new_start: 3 })
		expect(else_arm?.old_lines).toStrictEqual([`\telse ${THROW}`])
	})

	it('reads an else if as its own if, not as an else arm', () => {
		const content = 'if (a) x()\nelse if (b) y()\nelse z()\n'

		expect(names(content)).toStrictEqual([IF_ARM, IF_ARM, ELSE_ARM])
	})

	it('leaves out an if with no else as an arm, and the operands of && and ||', () => {
		expect(names('if (a) f()\nconst v = b || c\nconst w = b && c\n')).toStrictEqual([IF_ARM])
	})
})

describe('test_pinned_branches.branch_hunks — expressions and clauses', () => {
	it('throws as an expression in both arms of ?: and the right side of ??', () => {
		const hunks = arms('const v = a ? b : c\nconst w = d ?? e\n')
		const expression = `(() => ${THROW})()`

		expect(hunks.map((hunk) => hunk.function_name)).toStrictEqual([
			TRUE_ARM,
			FALSE_ARM,
			NULLISH_ARM,
		])
		expect(hunks.map((hunk) => hunk.old_lines[0])).toStrictEqual([
			`const v = a ? ${expression} : c`,
			`const v = a ? b : ${expression}`,
			`const w = d ?? ${expression}`,
		])
	})

	it('throws at the first statement of a clause and skips an empty fall-through case', () => {
		const content = [
			'switch (k) {',
			"\tcase 'a':",
			"\tcase 'b':",
			'\t\tf()',
			'\t\tbreak',
			'\tdefault:',
			'\t\tg()',
			'}',
		].join('\n')
		const hunks = arms(content)

		expect(hunks.map((hunk) => hunk.function_name)).toStrictEqual(['case branch', 'default branch'])
		expect(hunks.map((hunk) => [hunk.new_start, hunk.old_lines[0]])).toStrictEqual([
			[4, INDENTED_THROW],
			[7, INDENTED_THROW],
		])
	})
})

describe('test_pinned_branches.branch_hunks — scope', () => {
	it('probes only a branch whose first line or arm first line is changed', () => {
		const content = ['if (a) {', '\tf()', '} else {', '\tg()', '}', 'const v = b ? 1 : 2'].join(
			'\n',
		)

		expect(names(content, new Set([6]))).toStrictEqual([TRUE_ARM, FALSE_ARM])
		expect(names(content, new Set([3]))).toStrictEqual([ELSE_ARM])
		expect(names(content, new Set([2, 4]))).toStrictEqual([])
	})

	it('reads no branch from a non-script file', () => {
		expect(
			test_pinned_branches.branch_hunks(ts, 'src/view.svelte', ONE_IF, undefined),
		).toStrictEqual([])
	})
})

describe('test_pinned_branches.changed_lines', () => {
	it('collects each file’s changed lines, a pure deletion adding none', () => {
		const lines = test_pinned_branches.changed_lines([
			hunk_at('a.ts', 2, 2),
			hunk_at('a.ts', 7, 1),
			hunk_at('b.ts', 4, 0),
		])

		expect([...lines].map(([file, set]) => [file, [...set]])).toStrictEqual([
			['a.ts', [2, 3, 7]],
			['b.ts', []],
		])
	})

	it('reads a grouped hunk’s lines off its parts, each in its own file', () => {
		const grouped = {
			...hunk_at('a.ts', 9, 1),
			parts: [hunk_at('a.ts', 9, 1), hunk_at('c.ts', 5, 1)],
		}
		const lines = test_pinned_branches.changed_lines([grouped])

		expect([...lines].map(([file, set]) => [file, [...set]])).toStrictEqual([
			['a.ts', [9]],
			['c.ts', [5]],
		])
	})
})

describe('test_pinned_branches.read', () => {
	it('reads changed lines’ branches and every branch of an added file', async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'pinned-branches-'))
		const changed = path.join(directory, 'changed.ts')
		const added = path.join(directory, 'added.ts')

		await writeFile(changed, 'const v = a ? 1 : 2\nconst w = b ?? 3\n')
		await writeFile(added, ONE_IF)
		const hunks = await test_pinned_branches.read([hunk_at(changed, 2, 1)], [added])

		await rm(directory, { recursive: true })

		expect(hunks.map((hunk) => [hunk.file, hunk.function_name])).toStrictEqual([
			[changed, NULLISH_ARM],
			[added, IF_ARM],
		])
	})

	it('reads no branch without typescript to parse the files', async () => {
		vi.spyOn(review_code_tree, 'load_typescript').mockReturnValue(undefined)

		expect(await test_pinned_branches.read([], ['missing.ts'])).toStrictEqual([])
	})
})

describe('a branch probe in the test:pinned report', () => {
	it('says no test takes the branch and asks for a test that does', () => {
		const hunk = branch({ related_tests: ['scripts/sample.test.ts'] })

		expect(test_pinned_logic.reason(hunk)).toBe(
			'a throw in this branch left every related test green: no test takes it',
		)
		expect(test_pinned_logic.hint(hunk)).toBe(`related tests: scripts/sample.test.ts; ${FIX}`)
	})

	it('says no related test ran when none did', () => {
		const hunk = branch({ is_green: false })

		expect(test_pinned_logic.reason(hunk)).toBe('no related test ran with a throw in this branch')
		expect(test_pinned_logic.hint(hunk)).toBe(`no related tests; ${FIX}`)
	})
})
