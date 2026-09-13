import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const { PROJECT_ROOT: REPO_ROOT } = await import('#scripts/init/init-paths')

// `scripts/git/telegram-notify.ts` is the only Telegram egress there is, so "this command cannot
// notify" is a question about imports rather than a promise in prose.
//
// **What this asserts is the direct import of every module the command reaches**, its own three plus
// the four readers they pull in — not a full transitive closure, which would drag in most of
// `scripts/` and stop telling anyone anything. That set is where such an import would realistically
// appear, and it is the set a regression here would have to go through.
describe('run:progress cannot reach Telegram', () => {
	it.each([
		'scripts/run/run-progress-cli.ts',
		'scripts/run/run-progress-read.ts',
		'scripts/run/run-progress.ts',
		'scripts/epic/epic-busy.ts',
		'scripts/lane/lane-registry.ts',
		'scripts/lane/lane-report.ts',
		'scripts/run/run-preflight.ts',
	])('%s imports no notification module', (source_path) => {
		expect(readFileSync(path.join(REPO_ROOT, source_path), 'utf8')).not.toMatch(
			/^import[^\n]*telegram/mu,
		)
	})
})
