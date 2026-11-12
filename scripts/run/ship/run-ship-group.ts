import type { ShipSection } from './run-ship'
import { run_ship_stage, type Phase } from './run-ship-stage'
import type { Step } from './run-ship-steps'

interface FailedStage {
	step: Step
	sections: ReadonlyArray<ShipSection>
}

// Drain both stages before returning a failure, so no reviewer races a stopped ship's repair.
async function run(
	step: Step,
	execute: (step: Step) => Promise<ShipSection>,
	sections: Array<ShipSection>,
): Promise<FailedStage | undefined> {
	const steps = step.beside === undefined ? [step] : [step, step.beside]
	const results = await Promise.all(steps.map(async (current) => await execute(current)))
	const failed = results.findLastIndex((section) => section.code !== 0)

	sections.push(...results.filter((_, index) => index !== failed))
	if (failed !== -1) sections.push(...results.slice(failed, failed + 1))
	const stopped_step = steps[failed]

	return stopped_step === undefined ? undefined : { step: stopped_step, sections }
}

// A green stage that found nothing to do ends skipped rather than done.
function settled_phase(section: ShipSection): Phase {
	const { PHASE } = run_ship_stage

	if (section.code !== 0) return PHASE.FAILED

	return section.is_skipped === true ? PHASE.SKIPPED : PHASE.DONE
}

const run_ship_group = { run, settled_phase }

export { run_ship_group }
