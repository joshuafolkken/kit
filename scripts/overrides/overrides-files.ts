import { file_reader } from '#scripts/read-file'
import { overrides_check, type OverridesSources } from './overrides-logic'

// A project may carry either source file and not the other — app-kit's package.json has no `pnpm`
// field at all — so a missing file reads as an empty document rather than aborting the check.
function read_current_sources(): OverridesSources {
	return {
		package_json: file_reader.read_file_or_empty(overrides_check.PACKAGE_JSON_PATH),
		workspace_yaml: file_reader.read_file_or_empty(overrides_check.WORKSPACE_YAML_PATH),
	}
}

function read_current_overrides(): Record<string, string> {
	return overrides_check.read_overrides(read_current_sources())
}

const overrides_files = { read_current_sources, read_current_overrides }

export { overrides_files }
