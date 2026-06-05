#!/usr/bin/env tsx
/**
 * Sync (or check) template workflow action pins against .github/workflows.
 *
 * Usage:
 *   tsx scripts/sync/sync-workflow-pins.ts            # rewrite template pins to match runtime
 *   tsx scripts/sync/sync-workflow-pins.ts --check    # verify pins are in sync; non-zero on drift
 *
 * .github/workflows is the single source of truth for action SHA pins. The
 * distributed templates/workflows/* intentionally diverge in structure, so only
 * the `uses:` pins are propagated. Dependabot bumps the runtime workflows only;
 * run this after an action bump to keep the templates in sync.
 */
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { workflow_pin_logic } from './workflow-pin-logic'

function check(): never {
	const drift = workflow_pin_logic.find_pin_drift()

	if (drift.length > 0) {
		console.error(workflow_pin_logic.format_drift_message(drift))
		process.exit(1)
	}

	console.info('✔ Template workflow pins are in sync with .github/workflows.')
	process.exit(0)
}

function sync(): never {
	const synced = workflow_pin_logic.sync_pins()
	const message =
		synced.length === 0
			? '✔ Template workflow pins already in sync with .github/workflows.'
			: `✔ Synced ${String(synced.length)} template workflow pin(s) from .github/workflows.`

	console.info(message)
	process.exit(0)
}

function main(): void {
	const { values } = parseArgs({
		options: { check: { type: 'boolean', default: false } },
		strict: true,
	})

	if (values.check) check()
	sync()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { check, sync }
