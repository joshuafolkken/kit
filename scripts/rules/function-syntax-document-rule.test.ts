import { agent_read_documents, read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2890: `prompts/coding-standards.md` showed `const get_user_data = () => {}` as
// the correct way to write a function, while `CLAUDE.md` requires `function` syntax. An agent copies
// an example faster than it reads a rule, so a document an agent reads must not demonstrate the
// arrow-const form as the way to write code. ESLint cannot see code inside a markdown fence, so this
// suite is the guard.

const FENCE = '```'
const CODE_LANGUAGES: ReadonlySet<string> = new Set([
	'ts',
	'typescript',
	'js',
	'javascript',
	'svelte',
])
// A fence demonstrating a mistake marks it with ❌ and switches back to the correct form with ✅;
// only the lines between a ❌ and the next ✅ are allowed to break the rule.
const WRONG_MARKER = '❌'
const RIGHT_MARKER = '✅'
// Matched in two halves — the declared name, then whether what is assigned is an arrow function —
// so an inline callback (`const values = items.map((item) => item.value)`) is not mistaken for one.
const DECLARATION = /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::[^=]*)?=(.*)$/u
const ARROW_HEAD = /^\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*(?::[^=]*)?=>/u
// The named SvelteKit route handlers `CLAUDE.md` exempts, which keep the typed-const arrow idiom.
const ROUTE_HANDLERS: ReadonlySet<string> = new Set([
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'PATCH',
	'OPTIONS',
	'HEAD',
	'load',
	'actions',
	'fallback',
])

const WRONG_COMMENT = '// ❌ wrong'
const ARROW_EXAMPLE = 'const get_user_data = () => {}'
const TYPED_ARROW_EXAMPLE = 'const run = (value: number): number => value'

interface FenceState {
	is_code: boolean
	is_open: boolean
	is_wrong_example: boolean
}

const OUTSIDE: FenceState = { is_code: false, is_open: false, is_wrong_example: false }

function next_fence_state(line: string, state: FenceState): FenceState {
	if (state.is_open) return OUTSIDE
	const language = line.slice(FENCE.length).trim()

	return { is_code: CODE_LANGUAGES.has(language), is_open: true, is_wrong_example: false }
}

function next_state(line: string, state: FenceState): FenceState {
	const trimmed = line.trimStart()
	if (trimmed.startsWith(FENCE)) return next_fence_state(trimmed, state)
	if (line.includes(WRONG_MARKER)) return { ...state, is_wrong_example: true }
	if (line.includes(RIGHT_MARKER)) return { ...state, is_wrong_example: false }

	return state
}

function is_arrow_declaration(line: string): boolean {
	const [, name, assigned] = DECLARATION.exec(line) ?? []
	if (name === undefined || assigned === undefined) return false

	return !ROUTE_HANDLERS.has(name) && ARROW_HEAD.test(assigned)
}

function is_violation(line: string, state: FenceState): boolean {
	return state.is_code && !state.is_wrong_example && is_arrow_declaration(line)
}

function arrow_declarations(text: string): Array<string> {
	const found: Array<string> = []
	let state = OUTSIDE

	for (const line of text.split('\n')) {
		state = next_state(line, state)
		if (is_violation(line, state)) found.push(line.trim())
	}

	return found
}

function fenced(language: string, lines: ReadonlyArray<string>): string {
	return [`${FENCE}${language}`, ...lines, FENCE].join('\n')
}

describe('arrow_declarations', () => {
	it('flags an arrow-const declaration in a code fence', () => {
		expect(arrow_declarations(fenced('typescript', [ARROW_EXAMPLE]))).toEqual([ARROW_EXAMPLE])
	})

	it('flags a typed arrow-const after a ✅ marker', () => {
		const text = fenced('ts', [WRONG_COMMENT, 'const a = 1', '// ✅ right', TYPED_ARROW_EXAMPLE])

		expect(arrow_declarations(text)).toEqual([TYPED_ARROW_EXAMPLE])
	})

	it('accepts an arrow-const shown as a mistake', () => {
		expect(arrow_declarations(fenced('ts', [WRONG_COMMENT, ARROW_EXAMPLE]))).toEqual([])
	})

	it('accepts the exempt SvelteKit route handlers', () => {
		const text = fenced('ts', ['export const load: PageLoad = async () => {}'])

		expect(arrow_declarations(text)).toEqual([])
	})

	it('accepts an inline callback assigned to a const', () => {
		const text = fenced('ts', ['const values = items.map((item) => item.value)'])

		expect(arrow_declarations(text)).toEqual([])
	})

	it('ignores fences that are not code', () => {
		expect(arrow_declarations(fenced('bash', [ARROW_EXAMPLE]))).toEqual([])
	})
})

describe.each(agent_read_documents())('%s', (document_path) => {
	it('shows no arrow-const function as the way to write code', () => {
		expect(arrow_declarations(read_repo_file(document_path))).toEqual([])
	})
})
