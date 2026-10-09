import { PACK_HOOK_FILE } from '#scripts/safe-chain/pack-hook'
import { PROJECT_CONFIG_FILE } from '#scripts/safe-chain/project-config'
import { managed_config_scope } from '#scripts/sync/managed-config-scope'
import { BASIC_PRETTIER_CONFIG } from './init-actions'
import { CLAUDE_MD_FILENAME } from './init-ai-copy'

const MANIFEST_FILE = 'package.json'
const LOCKFILE = 'pnpm-lock.yaml'

// The paths `josh init` writes beyond what `managed_config_scope` enumerates. They stay out of that
// scope on purpose: it also answers the pull-request gate on distributed config, which leaves
// CLAUDE.md out by design. The manifest and lockfile are written by the install `josh init` runs.
const SETUP_ONLY_PATHS: ReadonlySet<string> = new Set([
	CLAUDE_MD_FILENAME,
	BASIC_PRETTIER_CONFIG,
	PROJECT_CONFIG_FILE,
	PACK_HOOK_FILE,
	MANIFEST_FILE,
	LOCKFILE,
])

// Whether a changed path is one kit's setup wrote — what the setup pull request of `josh start`
// carries, so a file the user keeps beside it (notes, an editor's own directory) never rides along.
function is_kit_written(file_path: string): boolean {
	return SETUP_ONLY_PATHS.has(file_path) || managed_config_scope.has_managed_path([file_path])
}

function select(paths: ReadonlyArray<string>): Array<string> {
	return paths.filter((file_path) => is_kit_written(file_path))
}

const kit_written_paths = { is_kit_written, select }

export { kit_written_paths }
