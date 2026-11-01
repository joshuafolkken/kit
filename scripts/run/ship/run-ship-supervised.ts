import { run_step_section } from '#scripts/run/run-step-section'
import { run_ship, type ShipSection } from './run-ship'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_probe } from './run-ship-probe'
import type { ShipArguments } from './run-ship-steps'

// The detached supervisor's own bookkeeping around a ship: it claims the launch record's identity
// before the first stage and writes the result there once the ship ends. A ship nobody detached
// has no record and does neither.

const SUCCESS_EXIT_CODE = 0

async function supervised_repository(): Promise<string | undefined> {
	return run_ship_detach.is_supervised() ? await run_ship_probe.repository_directory() : undefined
}

async function claim_identity(args: ShipArguments): Promise<void> {
	const repository = await supervised_repository()
	if (repository !== undefined) await run_ship_detach.claim_identity(repository, args.number)
}

async function record_result(
	args: ShipArguments,
	sections: ReadonlyArray<ShipSection>,
): Promise<void> {
	const repository = await supervised_repository()
	if (repository === undefined) return
	await run_ship_detach.mark_result(repository, args.number, run_ship.exit_code(sections))
}

// The section is printed to the session that typed the ship, never into a detached supervisor's log.
function print_section(): number {
	return run_ship_detach.is_supervised() ? SUCCESS_EXIT_CODE : run_step_section.print_once('ship')
}

const run_ship_supervised = { claim_identity, print_section, record_result }

export { run_ship_supervised }
