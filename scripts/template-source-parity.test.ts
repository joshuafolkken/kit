import { describe, expect, it } from 'vitest'
import { template_source_logic } from './template-source-logic'

// Co-change tripwire: if a root source (sonar-project.properties / .gitignore)
// is edited without reconciling the manifest, this test fails and points at the
// paired template that must be reviewed. Run `pnpm josh reconcile-templates`
// after reviewing to acknowledge.
describe('template source parity', () => {
	it('every recorded source hash matches the current source file', () => {
		const recorded = template_source_logic.read_recorded_manifest()
		const current = template_source_logic.compute_current_manifest()
		const drifted = template_source_logic.find_drifted_pairs(recorded, current)

		expect(drifted, template_source_logic.format_drift_message(drifted)).toEqual([])
	})

	it('records a hash for every tracked template source', () => {
		const recorded = template_source_logic.read_recorded_manifest()
		const tracked_sources = template_source_logic.TEMPLATE_SOURCE_PAIRS.map((pair) => pair.source)

		for (const source of tracked_sources) expect(recorded, source).toHaveProperty([source])
	})
})
