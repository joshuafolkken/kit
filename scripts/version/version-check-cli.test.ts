import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const UPGRADE_FLAG = '--upgrade'
const VERSION_CHECK_SCRIPT = 'scripts/version/version-check.ts'

function run_version_check(argument: string): ReturnType<typeof spawnSync> {
	return spawnSync(process.execPath, ['--import', 'tsx', VERSION_CHECK_SCRIPT, argument], {
		encoding: 'utf8',
	})
}

describe('version-check CLI arguments', () => {
	it('rejects --update with an upgrade hint and a failing exit code', () => {
		const result = run_version_check('--update')

		expect(result.status).toBe(1)
		expect(result.stderr).toContain(UPGRADE_FLAG)
		expect(result.stdout).toBe('')
	})

	it('rejects other unsupported arguments', () => {
		const result = run_version_check('--unknown')

		expect(result.status).toBe(1)
		expect(result.stderr).toContain('--unknown')
	})
})
