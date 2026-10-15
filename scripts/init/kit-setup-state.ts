import { json_value } from '#scripts/lib/json-value'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { start_exec } from './start-exec'
import { workflow_mark } from './workflow-mark'

// Whether the commit checked out holds `josh start`'s setup — its manifest lists kit and records the
// GitHub workflow mark — the sign that the setup has already reached the branch, so `josh start` has
// no setup pull request to open. Kit alone is not enough: a committed `josh init` setup lacks the mark
// and, on `basic`, `.claude/settings.json`, which `josh start`'s setup then writes and only a setup
// pull request carries to `main` (#3835).
function is_kit_committed(root: string): boolean {
	// `./` resolves the path from `root` rather than from the repository's top level.
	const manifest = start_exec.git_read(['show', 'HEAD:./package.json'], root)

	if (manifest?.includes(`"${KIT_PACKAGE_NAME}"`) !== true) return false

	const parsed = json_value.parse_or_undefined(manifest)

	return workflow_mark.is_recorded(json_value.is_record(parsed) ? parsed : undefined)
}

const kit_setup_state = { is_kit_committed }

export { kit_setup_state }
