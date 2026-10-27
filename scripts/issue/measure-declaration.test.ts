import { describe, expect, it } from 'vitest'
import { measure_declaration } from './measure-declaration'

// joshuafolkken/kit#4621: the measurement declaration `backlog:drive` runs before it opens a lane.

const BACKGROUND = '## 背景\n\n'
const DECLARED = `${BACKGROUND}- 計測宣言: \`pnpm josh count\` <= 5\n`

describe('measure_declaration.parse', () => {
	it('reads the command, the operator and the bound', () => {
		expect(measure_declaration.parse(DECLARED)).toStrictEqual({
			command: 'pnpm josh count',
			operator: '<=',
			threshold: 5,
		})
	})

	it.each(['<', '>=', '>'] as const)('reads the %s operator and a negative decimal', (operator) => {
		const body = `${BACKGROUND}- 計測宣言: \`echo 1\` ${operator} -2.5\n`

		expect(measure_declaration.parse(body)).toStrictEqual({
			command: 'echo 1',
			operator,
			threshold: -2.5,
		})
	})

	it.each([
		['no declaration', `${BACKGROUND}- 種別: 非不具合\n`],
		['a declaration outside the background', `## 現象\n\n- 計測宣言: \`echo 1\` <= 5\n`],
		[
			'a declaration in a fenced example',
			`${BACKGROUND}\`\`\`md\n- 計測宣言: \`echo 1\` <= 5\n\`\`\`\n`,
		],
		['a malformed declaration', `${BACKGROUND}- 計測宣言: echo 1 under 5\n`],
	])('reads nothing from %s', (_case, body) => {
		expect(measure_declaration.parse(body)).toBeUndefined()
	})
})

describe('measure_declaration.problems', () => {
	it('names the shape of a malformed declaration', () => {
		const found = measure_declaration.problems(`${BACKGROUND}- 計測宣言: \`echo 1\` = 5\n`)

		expect(found).toStrictEqual([
			expect.stringContaining(
				`\`${measure_declaration.PREFIX}\` must be written ${measure_declaration.DECLARATION}\n`,
			),
		])
	})

	// joshuafolkken/kit#5225: the refusal's last line is an example the declaration reads as pasted.
	it('ends the refusal in a one-line example that parses', () => {
		const [found = ''] = measure_declaration.problems(`${BACKGROUND}- 計測宣言: soon\n`)
		const example = found.split('\n').at(-1) ?? ''

		expect(example).toMatch(/^- 計測宣言: `/u)
		expect(measure_declaration.parse(`${BACKGROUND}${example}\n`)).toBeDefined()
	})

	it.each([DECLARED, `${BACKGROUND}- 種別: 非不具合\n`])('finds no problem in %j', (body) => {
		expect(measure_declaration.problems(body)).toStrictEqual([])
	})
})

// joshuafolkken/kit#5144: a follow-up states its measurement — a declaration line, or a reason for none.
describe('measure_declaration.is_stated', () => {
	it.each([
		['a declaration', DECLARED],
		['a malformed declaration line', `${BACKGROUND}- 計測宣言: count <= 5\n`],
		['a reason for none', `${BACKGROUND}- 計測宣言なし: 外部サービスの画面でしか見えない\n`],
	])('holds for %s', (_case, body) => {
		expect(measure_declaration.is_stated(body)).toBe(true)
	})

	it.each([
		['no line', `${BACKGROUND}- 種別: 非不具合\n`],
		['an empty reason', `${BACKGROUND}- 計測宣言なし:\n`],
		['a reason outside the background', `## 現象\n\n- 計測宣言なし: 外部の値\n`],
		['a reason in a fence', `${BACKGROUND}\`\`\`\n- 計測宣言なし: 外部の値\n\`\`\`\n`],
	])('fails for %s', (_case, body) => {
		expect(measure_declaration.is_stated(body)).toBe(false)
	})
})

describe('measure_declaration.judge', () => {
	const declaration = { command: 'echo', operator: '<=', threshold: 5 } as const

	it.each([
		['5', { kind: 'pass', value: 5 }],
		['6', { kind: 'fail', value: 6 }],
		['log line\n4.5\n\n', { kind: 'pass', value: 4.5 }],
	])('judges the last line of %j', (output, expected) => {
		expect(measure_declaration.judge(declaration, output)).toStrictEqual(expected)
	})

	it.each(['', '5 merges', 'none'])('reads %j as unreadable', (output) => {
		expect(measure_declaration.judge(declaration, output)).toStrictEqual({ kind: 'unreadable' })
	})

	it.each([
		['<', 4, 'pass'],
		['<', 5, 'fail'],
		['>=', 5, 'pass'],
		['>', 5, 'fail'],
	] as const)('judges %s against the bound', (operator, value, kind) => {
		const verdict = measure_declaration.judge({ ...declaration, operator }, String(value))

		expect(verdict).toStrictEqual({ kind, value })
	})
})

describe('measure_declaration.format', () => {
	it('writes the declaration back as the body spells it', () => {
		const declaration = { command: 'echo 1', operator: '>', threshold: 2 } as const

		expect(measure_declaration.format(declaration)).toBe('`echo 1` > 2')
	})
})
