import path from 'node:path'
import { import_closure, SCRIPTS_DIR } from '#scripts/build/import-closure-fixture'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { epic_audit_cli } from './epic-audit-cli'

// `run:split` calls `epic:audit` in its own process, so `epic-audit-cli.ts` must import without a main
// guard of its own; the entry carries it instead (joshuafolkken/kit#5912).
describe('the josh epic:audit entry', () => {
	it('leaves epic-audit-cli.ts importable without a main guard', () => {
		expect(typeof epic_audit_cli.run).toBe('function')
		expect(import_closure.has_main_guard(path.join(SCRIPTS_DIR, 'epic', 'epic-audit-cli.ts'))).toBe(
			false,
		)
	})

	it('runs from epic-audit-main.ts, which carries the main guard', () => {
		expect(COMMAND_MAP['epic:audit']?.script).toBe('scripts/epic/epic-audit-main.ts')
		expect(
			import_closure.has_main_guard(path.join(SCRIPTS_DIR, 'epic', 'epic-audit-main.ts')),
		).toBe(true)
	})
})
