import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./epic-bundle-cli', () => ({ epic_bundle_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'epic:bundle',
	entry: 'scripts/epic/epic-bundle-main.ts',
	library: 'scripts/epic/epic-bundle-cli.ts',
	run,
})

describe('epic-bundle-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
