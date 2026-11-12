import os from 'node:os'
import path from 'node:path'

// Shared across repositories; readers import these paths rather than reconstructing them.
function josh_directory(): string {
	const directory = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude')

	return path.join(directory, 'josh')
}

function claude(): string {
	return path.join(josh_directory(), 'usage.json')
}

// The sections a person folded on a live `run:board` (`run-board-fold-store.ts`).
function board(): string {
	return path.join(josh_directory(), 'board.json')
}

const usage_state_path = { board, claude }

export { usage_state_path }
