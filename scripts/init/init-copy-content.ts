import { workflow_pin_logic } from '#scripts/sync/workflow-pin-logic'
import { init_logic } from './init-logic'

/**
 * The single transform applied to every file kit copies verbatim into a consumer
 * repository, by both `josh init` and `josh sync`.
 *
 * Workflow destinations additionally get their action pins resolved from
 * .github/workflows, so the committed template refs never have to be current. Keeping
 * both write paths on this one function is what makes that guarantee hold: a path that
 * called only transform_prompt_paths would ship whatever ref the template happens to
 * carry. See workflow-pin-logic.ts for why the template refs are not authoritative.
 */
function transform_copied_content(destination_path: string, content: string): string {
	return workflow_pin_logic.apply_pins_for_destination(
		destination_path,
		init_logic.transform_prompt_paths(content),
	)
}

export { transform_copied_content }
