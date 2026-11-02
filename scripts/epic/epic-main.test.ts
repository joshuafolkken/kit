import path from 'node:path'
import { import_closure, SCRIPTS_DIR } from '#scripts/build/import-closure-fixture'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { epic_command } from './epic'

// `run:split` calls `epic` in its own process, so `epic.ts` must import without running a main of its
// own; the entry carries the guard instead (joshuafolkken/kit#5912).
describe('the josh epic entry', () => {
	it('leaves epic.ts importable without running a command', () => {
		expect(typeof epic_command.run).toBe('function')
		expect(import_closure.has_main_guard(path.join(SCRIPTS_DIR, 'epic', 'epic.ts'))).toBe(false)
	})

	it('runs from epic-main.ts, which carries the main guard', () => {
		expect(COMMAND_MAP['epic']?.script).toBe('scripts/epic/epic-main.ts')
		expect(import_closure.has_main_guard(path.join(SCRIPTS_DIR, 'epic', 'epic-main.ts'))).toBe(true)
	})
})
