#!/usr/bin/env tsx
/**
 * Reconcile (or check) the template source manifest.
 *
 * Usage:
 *   tsx scripts/reconcile-templates.ts            # record current source hashes (acknowledge review)
 *   tsx scripts/reconcile-templates.ts --check    # verify manifest matches sources; non-zero on drift
 *
 * A root source edit (sonar-project.properties / .gitignore) trips --check until
 * the paired template is reviewed and the manifest is reconciled. Whether the
 * change propagates to the template is a human decision; only the review is enforced.
 */
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { template_source_logic } from './template-source-logic'

function check_drift(): never {
	const recorded = template_source_logic.read_recorded_manifest()
	const current = template_source_logic.compute_current_manifest()
	const drifted = template_source_logic.find_drifted_pairs(recorded, current)

	if (drifted.length > 0) {
		console.error(template_source_logic.format_drift_message(drifted))
		process.exit(1)
	}

	console.info('✔ Template sources unchanged since last reconciled.')
	process.exit(0)
}

function reconcile(): never {
	template_source_logic.write_recorded_manifest(template_source_logic.compute_current_manifest())
	console.info(`✔ Template source manifest reconciled (${template_source_logic.MANIFEST_PATH}).`)
	process.exit(0)
}

function main(): void {
	const { values } = parseArgs({
		options: { check: { type: 'boolean', default: false } },
		strict: true,
	})

	if (values.check) check_drift()
	reconcile()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { check_drift, reconcile }
