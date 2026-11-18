import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { test_symbol_mocks } from './test-symbol-mocks'

function mock_in(text: string): ReturnType<typeof test_symbol_mocks.mock_of> {
	const source = ts.createSourceFile('a.test.ts', text, ts.ScriptTarget.Latest, true)
	const [statement] = source.statements

	return statement === undefined ? undefined : test_symbol_mocks.mock_of(ts, statement)
}

describe('test_symbol_mocks.mock_of', () => {
	it('reads a mock replacing its module whole', () => {
		expect(mock_in(`vi.mock('./thing', () => ({ run: vi.fn() }))`)).toEqual({
			specifier: './thing',
			is_partial: false,
		})
	})

	it('reads a mock built on the original as partial', () => {
		const text = `vi.mock('./thing', async (importOriginal) => ({ ...(await importOriginal()) }))`

		expect(mock_in(text)).toEqual({ specifier: './thing', is_partial: true })
	})

	it('reads vi.importActual as keeping the original', () => {
		const text = `vi.mock('./thing', async () => ({ ...(await vi.importActual('./thing')) }))`

		expect(mock_in(text)?.is_partial).toBe(true)
	})

	it('reads no mock from any other statement or a non-literal specifier', () => {
		expect(mock_in(`run('./thing')`)).toBeUndefined()
		expect(mock_in(`vi.mock(name)`)).toBeUndefined()
	})
})
