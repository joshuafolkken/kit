import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { package_path } from './init-paths'
import { template_source_logic } from './template-source-logic'

// CI guard. Copy pairs must be byte-for-byte identical to their source; tripwire
// pairs must match the reconciled hash. A drift here means a source was edited
// without `pnpm josh reconcile-templates`.
describe('template source parity', () => {
	it('every copy template is byte-for-byte identical to its source', () => {
		const drift = template_source_logic.find_copy_drift()

		expect(drift, template_source_logic.format_drift_message(drift, [])).toEqual([])
	})

	it('templates/gitignore matches root .gitignore exactly', () => {
		const template = readFileSync(package_path('templates/gitignore'), 'utf8')
		const source = readFileSync(package_path('.gitignore'), 'utf8')

		expect(template).toBe(source)
	})

	it('every tripwire source matches its reconciled hash', () => {
		const recorded = template_source_logic.read_recorded_manifest()
		const drift = template_source_logic.find_tripwire_drift(recorded)

		expect(drift, template_source_logic.format_drift_message([], drift)).toEqual([])
	})

	it('records a hash for every tripwire source', () => {
		const recorded = template_source_logic.read_recorded_manifest()

		for (const pair of template_source_logic.TRIPWIRE_PAIRS) {
			expect(recorded, pair.source).toHaveProperty([pair.source])
		}
	})
})
