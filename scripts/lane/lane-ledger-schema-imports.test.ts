import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const { PROJECT_ROOT: REPO_ROOT } = await import('#scripts/init/init-paths')
const WRITER = 'scripts/lane/lane-ledger-write.ts'

// Whole-declaration type imports remove the runtime edge; inline type specifiers do not.
describe('ledger schema import boundaries', () => {
	it.each([
		WRITER,
		'scripts/lane/lane-load.ts',
		'scripts/lane/lane-size-stats.ts',
		'scripts/gate/gate-ledger.ts',
		'scripts/gate/core-wait-record.ts',
		'scripts/test/test-related-record.ts',
		'scripts/hooks/pre-push-unit.ts',
		'scripts/run/ship/run-ship-stop-cause.ts',
		'scripts/run/ship/run-ship-lap.ts',
		'scripts/run/ship/run-ship-overlap.ts',
	])('%s imports only types from the schema', (source_path) => {
		const source = readFileSync(path.join(REPO_ROOT, source_path), 'utf8')
		const imports = source.match(
			/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"][^'"]*lane-ledger-schema['"]/gu,
		)

		expect(imports).not.toBeNull()
		expect(imports?.every((declaration) => declaration.startsWith('import type '))).toBe(true)
	})

	it.each([
		[WRITER, './lane-ledger-kind'],
		['scripts/test/test-pinned-ledger.ts', '#scripts/lane/lane-ledger-pinned-origin'],
	])('%s takes runtime values from %s', (source_path, leaf) => {
		const source = readFileSync(path.join(REPO_ROOT, source_path), 'utf8')

		expect(source).toContain(`from '${leaf}'`)
		expect(source).not.toMatch(/import\s+\{[^}]*\}\s+from\s+['"][^'"]*lane-ledger-schema['"]/u)
	})
})
