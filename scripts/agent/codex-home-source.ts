import os from 'node:os'
import path from 'node:path'

// Resolve the default Codex home in a read-only module, separate from reviewer state setup.
function default_home(): string {
	return path.join(os.homedir(), '.codex')
}

const codex_home_source = { default_home }

export { codex_home_source }
