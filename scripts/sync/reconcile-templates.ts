#!/usr/bin/env tsx
/**
 * Reconcile (or check) distributed templates against their root sources.
 *
 * Usage:
 *   tsx scripts/sync/reconcile-templates.ts            # regenerate copy templates + record tripwire hashes
 *   tsx scripts/sync/reconcile-templates.ts --check    # verify templates are in sync; non-zero on drift
 *
 * Copy pairs (e.g. .gitignore → templates/gitignore) are byte-for-byte copies,
 * regenerated automatically. Tripwire pairs (e.g. sonar-project.properties)
 * intentionally diverge: a source edit trips --check until the paired template
 * is reviewed and reconciled. Only the review is enforced for tripwire pairs.
 */
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { template_source_logic } from './template-source-logic'

function check_drift(): never {
	const copy_drift = template_source_logic.find_copy_drift()
	const tripwire_drift = template_source_logic.find_tripwire_drift(
		template_source_logic.read_recorded_manifest(),
	)

	if (copy_drift.length + tripwire_drift.length > 0) {
		console.error(template_source_logic.format_drift_message(copy_drift, tripwire_drift))
		process.exit(1)
	}

	console.info('✔ Templates are in sync with their sources.')
	process.exit(0)
}

function reconcile(): never {
	template_source_logic.reconcile()
	console.info(
		`✔ Templates reconciled (copies regenerated; ${template_source_logic.MANIFEST_PATH} updated).`,
	)
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
