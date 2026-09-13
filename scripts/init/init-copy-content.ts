import { managed_marker_logic } from '#scripts/managed-marker/managed-marker-logic'
import { workflow_pin_logic } from '#scripts/sync/workflow-pin-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { claude_plugin_config } from './claude-plugin-config'
import { hook_command_rewrite } from './hook-command-rewrite'
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
 *
 * The consumer's `.claude/settings.json` gets two further passes. The kit plugin's marketplace and
 * `enabledPlugins` declaration is injected, because the skills that used to be copied now ship as the
 * `kit` plugin and load from that declaration (joshuafolkken/kit#1879). And its hook commands are
 * rewritten from `pnpm josh` to the published bundle invoked directly with node
 * (joshuafolkken/kit#1930), so a consumer's guarded call does not pay a `pnpm` launch it never needed.
 * Keeping both on this one function is the same guarantee as the workflow passes — a copy path that
 * skipped the plugin block would ship a settings file that never enables the plugin, and one that
 * skipped the rewrite would leave every consumer hook slower than it has to be.
 */
function transform_copied_content(destination_path: string, content: string): string {
	const with_paths = init_logic.transform_distributed_paths(content)
	const with_pins = workflow_pin_logic.apply_pins_for_destination(destination_path, with_paths)
	const with_marker = managed_marker_logic.apply_marker_for_destination(
		destination_path,
		with_pins,
		KIT_PACKAGE_NAME,
	)
	const with_plugin = claude_plugin_config.apply_plugin_config_for_destination(
		destination_path,
		with_marker,
	)

	return hook_command_rewrite.apply_hook_command_rewrite_for_destination(
		destination_path,
		with_plugin,
	)
}

export { transform_copied_content }
