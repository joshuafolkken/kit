import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_pinned_functions } from './test-pinned-functions'
import { test_pinned_logic } from './test-pinned-logic'

const FILE = 'scripts/review/reviewed-tree.ts'
const STUB = test_pinned_functions.STUB_BODY

const MODULE = `import { x } from './x'

function mark_stopped(issue: number): void {
	x(issue)
}

function overload(value: string): string
function overload(value: string): string {
	return value
}

const resume_point = (checkout: string): string => checkout.trim()

const LIMIT = 3

const reviewed_tree = {
	mark_stopped,
	discard(issue: number): void {
		x(issue)
	},
	is_stopped_on: function (issue: number): boolean {
		return issue > LIMIT
	},
	LIMIT,
}

export { reviewed_tree, resume_point }
`

function probes(content: string): ReadonlyArray<{ label: string; text: string }> {
	return test_pinned_functions.stub_hunks(ts, FILE, content).map((hunk) => ({
		label: `${String(hunk.new_start)} ${String(hunk.function_name)}`,
		text: test_pinned_logic.revert(content, hunk),
	}))
}

describe('test_pinned_functions.stub_hunks', () => {
	it('probes each top-level function and each function member of a namespace object', () => {
		expect(probes(MODULE).map(({ label }) => label)).toEqual([
			'3 mark_stopped',
			'8 overload',
			'12 resume_point',
			'18 reviewed_tree.discard',
			'21 reviewed_tree.is_stopped_on',
		])
	})

	it('replaces only the probed function body with the throw, keeping the signature', () => {
		const [first, , arrow, method] = probes(MODULE)

		expect(first?.text).toContain(`function mark_stopped(issue: number): void ${STUB}\n\nfunction`)
		expect(arrow?.text).toContain(`const resume_point = (checkout: string): string => ${STUB}\n`)
		expect(method?.text).toContain(`\tdiscard(issue: number): void ${STUB},\n\tis_stopped_on`)
		expect(method?.text).toContain('return issue > LIMIT')
	})

	it('leaves the rest of the module untouched outside the probed lines', () => {
		const [first] = probes(MODULE)

		expect(first?.text.replace(`void ${STUB}`, 'void {\n\tx(issue)\n}')).toBe(MODULE)
	})

	it('probes nothing in a module of constants and types', () => {
		expect(probes('const A = 1\ntype B = string\nexport { A, type B }\n')).toEqual([])
	})

	// joshuafolkken/kit#4775: an unpinned function's key reads its body, which the stub replaced.
	it('keeps the lines the function spans as the lines the probe replaces', () => {
		const [first] = test_pinned_functions.stub_hunks(ts, FILE, MODULE)

		expect(first?.new_lines).toEqual([
			'function mark_stopped(issue: number): void {',
			'\tx(issue)',
			'}',
		])
	})
})

describe('test_pinned_functions.is_script', () => {
	it('parses script files and not Svelte components', () => {
		const files = ['a.ts', 'b.mjs', 'c.tsx', 'd.svelte']

		expect(files.map((file) => test_pinned_functions.is_script(file))).toEqual([
			true,
			true,
			true,
			false,
		])
	})
})
