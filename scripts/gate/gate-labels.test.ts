import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { gate_labels } from './gate-labels'

const SOURCE_FILE = fileURLToPath(new URL('gate-labels.ts', import.meta.url))

describe('gate_labels — the check names, in a leaf', () => {
	// joshuafolkken/kit#5177: an import here would carry its module into every test reaching a reader.
	it('imports nothing', () => {
		expect(readFileSync(SOURCE_FILE, 'utf8')).not.toMatch(/^import |^export .* from |import\(/mu)
	})

	it('withholds the green record on the lint and type-check warnings only', () => {
		expect(gate_labels.WARNING_CHECKER_LABELS).toStrictEqual([
			gate_labels.LINT_LABEL,
			gate_labels.TYPE_CHECK_LABEL,
		])
	})
})
