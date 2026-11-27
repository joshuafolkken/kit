import type { run_board_sound_player } from '#scripts/run/board/run-board-sound-player'
import type { run_board_sound_resident } from '#scripts/run/board/run-board-sound-resident'
import { vi } from 'vitest'
import { test_guard_record } from './test-guard-record'

// **A unit test must not start the real run:board sound player** (joshuafolkken/kit#9094). A themed
// `run_board_live.watch` warms and plays through the player's default ports, which spawn a real
// `osascript` / `afplay` — sounds a user watching `run:board` heard while a parallel lane ran tests.
//
// **This replaces the default ports' `spawner`, not `node:child_process`**: a test that injects its
// own spawner (`run-board-sound-player.test.ts`, `run-board-sound-resident.test.ts`) never reaches
// the default, and every other spawn in the worker is left alone.
//
// **The attempt is recorded in the network guard's log**, as the Telegram guard records a send:
// the player catches a throwing spawn as a failed candidate, so the in-place throw alone would pass
// silently — the record is what fails the run at teardown, naming the test.

const RECORD_NAME = 'sound'
const BLOCKED_MESSAGE =
	'josh: the unit suite must not start the run:board sound player — fake it instead'

interface Ports {
	spawner: unknown
}

function blocked_spawner(): never {
	test_guard_record.record(RECORD_NAME)

	throw new Error(BLOCKED_MESSAGE)
}

// Setting it again is harmless, so `isolate: false` re-running the setup file needs no mark.
function guard(ports: Ports): void {
	Reflect.set(ports, 'spawner', blocked_spawner)
}

// **Guarded at import, not here**: a static import would load the sound modules — and what they
// import — into every worker before a test's own `vi.mock` of those dependencies applies.
vi.mock('#scripts/run/board/run-board-sound-player', async (import_original) => {
	const actual = await import_original<{
		run_board_sound_player: typeof run_board_sound_player
	}>()

	guard(actual.run_board_sound_player.DEFAULT_PORTS)

	return actual
})

vi.mock('#scripts/run/board/run-board-sound-resident', async (import_original) => {
	const actual = await import_original<{
		run_board_sound_resident: typeof run_board_sound_resident
	}>()

	guard(actual.run_board_sound_resident.DEFAULT_PORTS)

	return actual
})

const test_sound_guard = { BLOCKED_MESSAGE, blocked_spawner }

export { test_sound_guard }
