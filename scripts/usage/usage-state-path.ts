import os from 'node:os'
import path from 'node:path'

// Shared across repositories; readers import this path rather than reconstructing it.
function claude(): string {
	const directory = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude')

	return path.join(directory, 'josh', 'usage.json')
}

const usage_state_path = { claude }

export { usage_state_path }
