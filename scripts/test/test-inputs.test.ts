import typescript from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_inputs } from './test-inputs'

const FILE = 'closed.ts'

describe('test_inputs.is_closed', () => {
	it('accepts local pure code, imports, callbacks and type annotations', () => {
		const source =
			'import { expect, test } from "vitest"; import { sum } from "./sum"; test("sum", () => { const values: number[] = [1]; expect(values.map(value => sum(value))).toEqual([2]) })'

		expect(test_inputs.is_closed(typescript, FILE, source)).toBe(true)
	})
	it.each([
		'process.env.TZ',
		'globalThis.fetch("url")',
		'fetch("url")',
		'Date.now()',
		'import(name)',
		'require(name)',
		'import.meta.url',
		'this.value',
		'import { vi as mock } from "vitest"; mock.importActual("./hidden")',
		'import { expect } from "vitest"; expect("actual").toMatchSnapshot()',
		'import { expect } from "vitest"; expect("actual").toMatchFileSnapshot("expected.txt")',
		'function local() { const fetch = () => 1 }; fetch("url")',
	])('refuses unknown input: %s', (source) => {
		expect(test_inputs.is_closed(typescript, FILE, source)).toBe(false)
	})
})
