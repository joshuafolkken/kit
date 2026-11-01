import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { import_specifiers } from './import-specifiers'

// joshuafolkken/kit#5789: the text the inert digest reads, with binding imports' specifiers emptied.

const SCRIPT = 'src/thing.ts'

describe('import_specifiers.blank', () => {
	it('empties the specifier of every binding import and keeps the bindings and the body', () => {
		const text = 'import { a } from \'./a\'\nimport type { B } from "./b"\nconst value = a\n'

		expect(import_specifiers.blank(ts, text, SCRIPT)).toBe(
			"import { a } from ''\nimport type { B } from ''\nconst value = a\n",
		)
	})

	it('keeps a side-effect import and a string that only looks like a specifier', () => {
		const text = "import './setup'\nconst path = './a'\n"

		expect(import_specifiers.blank(ts, text, SCRIPT)).toBe(text)
	})

	it('returns a `.svelte` file as it is', () => {
		const text = "<script>\nimport { a } from './a'\n</script>\n"

		expect(import_specifiers.blank(ts, text, 'src/view.svelte')).toBe(text)
	})
})
