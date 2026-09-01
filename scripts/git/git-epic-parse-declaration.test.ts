import { describe, expect, it } from 'vitest'
import {
	has_declared_dependency_chain,
	has_machine_readable_declaration,
	has_unordered_declaration,
	UNORDERED_DEPENDENCIES,
} from './git-epic-parse'

// What an epic body's `Dependencies` section declares, read by the three predicates that answer it.
// Split from `git-epic-parse.test.ts` so the declaration's own cases sit together, the same way the
// chain parsing has its own file.

const SIMPLE_CHAIN = '#101 -> #102'
const PROSE_ORDER = '#102 depends on #101'

function dependencies_body(declaration: string): string {
	return `## Dependencies\n\n${declaration}\n`
}

const DEPENDENCY_CASES = [
	{
		label: 'detects an ascii arrow chain under Dependencies',
		body: dependencies_body('#101 -> #102 -> #103'),
		expected: true,
	},
	{
		label: 'detects a unicode arrow chain',
		body: dependencies_body('#101 → #102'),
		expected: true,
	},
	{
		label: 'detects a chain written behind a list marker',
		body: dependencies_body(`- ${SIMPLE_CHAIN}`),
		expected: true,
	},
	{
		label: 'detects a chain written without surrounding spaces',
		body: dependencies_body('#101->#102'),
		expected: true,
	},
	// The existence reader and the link reader answer from one definition since
	// joshuafolkken/kit#1155, so a line the link reader will not parse is not a declaration here
	// either — `epic:check` used to call such a body machine-readable while `epic:next` read no links
	// from it.
	{
		label: 'reports none for a chain line carrying a trailing rationale',
		body: dependencies_body('#101 -> #102 -> #103 (#102 needs the API from #101)'),
		expected: false,
	},
	{
		label: 'reports none when the batch is declared unordered',
		body: dependencies_body(UNORDERED_DEPENDENCIES),
		expected: false,
	},
	{
		label: 'reports none for a bare list of children with no arrow',
		body: dependencies_body('#101, #102, #103'),
		expected: false,
	},
	// The reproduction from joshuafolkken/kit#1155: an epic created without `--ordered`, whose split
	// rationale recommends an execution order in prose. `epic:check` reported the batch as ordered
	// against its own `None — ...` literal, and `josh followup` said the order was never recorded on
	// every child's merge. Recommending an order in prose is legitimate, so the reading is what moved.
	{
		label: 'reports none for an arrow inside a rationale paragraph',
		body: `## Split rationale\n\nRunning #102 first is sensible (${SIMPLE_CHAIN}).\n\n${dependencies_body(UNORDERED_DEPENDENCIES)}`,
		expected: false,
	},
	{
		label: 'reports none for a prose line whose whole content is a recommendation',
		body: `${dependencies_body(UNORDERED_DEPENDENCIES)}\nSuggested order: #101 -> #102 -> #103\n`,
		expected: false,
	},
	{ label: 'reports none when the body is undefined', body: undefined, expected: false },
	{
		label: 'ignores a chain shown only inside a fenced template sample',
		body: `\`\`\`md\n${dependencies_body(SIMPLE_CHAIN)}\`\`\`\n\n${dependencies_body('None — independent.')}`,
		expected: false,
	},
] as const satisfies ReadonlyArray<{ label: string; body: string | undefined; expected: boolean }>

describe('has_declared_dependency_chain', () => {
	it.each(DEPENDENCY_CASES)('$label', ({ body, expected }) => {
		expect(has_declared_dependency_chain(body)).toBe(expected)
	})
})

describe('has_unordered_declaration', () => {
	it('detects the literal that declares a batch to have no order', () => {
		expect(has_unordered_declaration(dependencies_body(UNORDERED_DEPENDENCIES))).toBe(true)
	})

	it('rejects a body whose dependencies are prose', () => {
		expect(has_unordered_declaration(dependencies_body(PROSE_ORDER))).toBe(false)
	})

	// Same reason every other predicate strips fences: an epic body may quote the template, and the
	// declaration inside that quote is an illustration rather than this epic's own.
	it('ignores the literal when it only appears inside a fenced block', () => {
		const body = dependencies_body(`see below\n\n\`\`\`md\n${UNORDERED_DEPENDENCIES}\n\`\`\``)

		expect(has_unordered_declaration(body)).toBe(false)
	})

	it('reports false for a missing body', () => {
		expect(has_unordered_declaration(undefined)).toBe(false)
	})
})

describe('has_machine_readable_declaration', () => {
	it('accepts a body declaring a chain and nothing else', () => {
		expect(has_machine_readable_declaration(dependencies_body(SIMPLE_CHAIN))).toBe(true)
	})

	it('accepts a body declaring the unordered literal and nothing else', () => {
		expect(has_machine_readable_declaration(dependencies_body(UNORDERED_DEPENDENCIES))).toBe(true)
	})

	// Both at once says there is an order and says there is none. `epic:check` used to pass such a
	// body while reporting only the half that contradicts the other (joshuafolkken/kit#1155).
	it('refuses a body declaring a chain and the unordered literal at once', () => {
		const body = dependencies_body(`${SIMPLE_CHAIN}\n\n${UNORDERED_DEPENDENCIES}`)

		expect(has_machine_readable_declaration(body)).toBe(false)
	})

	it('refuses a body whose order is prose', () => {
		expect(has_machine_readable_declaration(dependencies_body(PROSE_ORDER))).toBe(false)
	})

	// A chain-only line outside the `Dependencies` section is not prose: `epic:next` reads its link
	// and the run follows it, so an unordered epic carrying one really is contradicting itself. That
	// is why the chain is read from the whole body rather than from the section.
	it('refuses a chain-only bullet outside the section beside the unordered literal', () => {
		const body = `## Split rationale\n\n- ${SIMPLE_CHAIN}\n\n${dependencies_body(UNORDERED_DEPENDENCIES)}`

		expect(has_machine_readable_declaration(body)).toBe(false)
	})
})
