import { managed_marker_logic } from '#scripts/managed-marker/managed-marker-logic'
import { workflow_pin_logic } from '#scripts/sync/workflow-pin-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { init_logic } from './init-logic'

/**
 * The single transform applied to every file kit copies verbatim into a consumer
 * repository, by both `josh init` and `josh sync`.
 *
 * Workflow destinations get two further passes. Their action pins are resolved from
 * .github/workflows, so the committed template refs never have to be current; and they are
 * stamped as written by this package, so the consumer's auto-merge workflow can tell a bump
 * kit will overwrite from one the consumer owns. Keeping both write paths on this one
 * function is what makes either guarantee hold: a path that called only
 * transform_prompt_paths would ship whatever ref the template happens to carry, and an
 * unstamped workflow would read as consumer-owned and merge itself into a revert loop. See
 * workflow-pin-logic.ts for why the template refs are not authoritative, and
 * managed-marker-logic.ts for why the stamp is on the file rather than in a list.
 */
function transform_copied_content(destination_path: string, content: string): string {
	const with_paths = init_logic.transform_prompt_paths(content)
	const with_pins = workflow_pin_logic.apply_pins_for_destination(destination_path, with_paths)

	return managed_marker_logic.apply_marker_for_destination(
		destination_path,
		with_pins,
		KIT_PACKAGE_NAME,
	)
}

export { transform_copied_content }
