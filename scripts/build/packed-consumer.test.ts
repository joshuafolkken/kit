import { josh_harness, type JoshEnvironment } from '#scripts/test/josh-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Smoke test: pack the real tarball, install in a temp consumer project, and run the published
// CLI through the bin entry. The assembly is the integration harness's packed environment
// (`scripts/test/josh-harness-environment.ts`). Excluded from the unit gate (slow — ~60 s setup);
// run before release with: pnpm vitest run --config vitest.harness.config.ts

const SETUP_TIMEOUT_MS = 120_000
const CMD_TIMEOUT_MS = 15_000
const CANNOT_FIND_MODULE = 'Cannot find module'
const ERR_MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const CMD_TIMEOUT_MSG = 'command timed out or failed to spawn'

const fixture: { consumer?: JoshEnvironment } = {}

function consumer(): JoshEnvironment {
	if (fixture.consumer === undefined) throw new Error('the packed consumer was not assembled')

	return fixture.consumer
}

beforeAll(async () => {
	fixture.consumer = await josh_harness.open_packed_consumer()
}, SETUP_TIMEOUT_MS)

afterAll(() => {
	if (fixture.consumer !== undefined) josh_harness.close_environment(fixture.consumer)
})

describe('packed-package consumer smoke', () => {
	it('josh help exits 0 and reports the version', () => {
		const result = josh_harness.run(consumer(), ['help'], CMD_TIMEOUT_MS)

		expect(result.is_timed_out, CMD_TIMEOUT_MSG).toBe(false)
		expect(result.exit_code).toBe(0)
		expect(result.stdout).toContain('josh v')
	})

	it.each(['init', 'sync'])('josh %s starts without a module resolution error', (command) => {
		const result = josh_harness.run(consumer(), [command], CMD_TIMEOUT_MS)

		expect(result.is_timed_out, CMD_TIMEOUT_MSG).toBe(false)
		expect(result.stderr).not.toContain(CANNOT_FIND_MODULE)
		expect(result.stderr).not.toContain(ERR_MODULE_NOT_FOUND)
	})
})
