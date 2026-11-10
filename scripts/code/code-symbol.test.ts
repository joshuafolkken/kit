import typescript from 'typescript'
import { describe, expect, it } from 'vitest'
import { code_symbol, type Declaration } from './code-symbol'

const PAIR_LINE = 'type Pair = [number, number]'
const FIXTURE = [
	'// A header comment a blank line separates.',
	'',
	'/** Adds two numbers. */',
	'function add(left: number, right: number): number {',
	'\treturn left + right',
	'}',
	'',
	'// The retry ceiling.',
	'export const LIMIT = 3',
	'',
	PAIR_LINE,
	'',
	'interface Point {',
	'\tx: number',
	'}',
	'',
	'class Counter {',
	'\tcount(): number {',
	'\t\treturn LIMIT',
	'\t}',
	'}',
].join('\n')

function find(name: string): Declaration | undefined {
	return code_symbol
		.declarations(typescript, 'fixture.ts', FIXTURE)
		.find((declaration) => declaration.name === name)
}

describe('code_symbol.declarations', () => {
	it.each([
		['add', 4, 3, '/** Adds two numbers. */\nfunction add'],
		['LIMIT', 9, 8, '// The retry ceiling.\nexport const LIMIT = 3'],
		['Pair', 11, 11, PAIR_LINE],
		['Point', 13, 13, 'interface Point {\n\tx: number\n}'],
		['count', 18, 18, '\tcount(): number {\n\t\treturn LIMIT\n\t}'],
	])('reads %s from its parse-tree extent', (name, line, first_line, text) => {
		const found = find(name)

		expect(found?.line).toBe(line)
		expect(found?.first_line).toBe(first_line)
		expect(found?.text.startsWith(text)).toBe(true)
	})

	it('reads a class to its closing brace', () => {
		expect(find('Counter')?.text.split('\n')).toHaveLength(5)
	})

	it('leaves out a comment a blank line separates', () => {
		expect(find('add')?.text).not.toContain('header comment')
	})
})

describe('code_symbol.numbered', () => {
	it('prefixes each line with its right-aligned number', () => {
		const declaration = { name: 'x', line: 9, first_line: 9, text: 'a\nb' }

		expect(code_symbol.numbered(declaration)).toBe(' 9\ta\n10\tb')
	})
})
