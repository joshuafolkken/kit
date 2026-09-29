import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { safe_chain_preinstall } from './preinstall-command'

const PROXY_URL = 'http://127.0.0.1:49681'
const LEGACY_VALUE = 'pnpm dlx @aikidosec/safe-chain setup-ci'
const PINNED_VALUE = 'pnpm dlx @aikidosec/safe-chain@1.5.20 setup-ci'
const CONSUMER_VALUE = 'npx only-allow pnpm'
const CHECKED_VARIABLES: ReadonlySet<string> = new Set(['CI', 'GLOBAL_AGENT_HTTP_PROXY'])

interface CheckResult {
	status: number | null
	stderr: string
}

function run_check(extra_environment: Record<string, string>): CheckResult {
	const base_environment = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !CHECKED_VARIABLES.has(key)),
	)
	const result = spawnSync(
		process.execPath,
		['-e', safe_chain_preinstall.LOCAL_INTEGRATION_CHECK_SOURCE],
		{ env: { ...base_environment, ...extra_environment }, encoding: 'utf8' },
	)

	return { status: result.status, stderr: result.stderr }
}

function read_own_preinstall(): string {
	const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
		scripts: { preinstall: string }
	}

	return manifest.scripts.preinstall
}

describe('local integration check', () => {
	it('warns with the setup hint when neither CI nor the safe-chain proxy is present', () => {
		const result = run_check({})

		expect(result.status).toBe(0)
		expect(result.stderr).toContain(safe_chain_preinstall.INTEGRATION_HINT)
	})

	it('stays silent when the install runs behind the safe-chain proxy', () => {
		const result = run_check({ GLOBAL_AGENT_HTTP_PROXY: PROXY_URL })

		expect(result.status).toBe(0)
		expect(result.stderr).toBe('')
	})

	it('stays silent on CI', () => {
		const result = run_check({ CI: 'true' })

		expect(result.status).toBe(0)
		expect(result.stderr).toBe('')
	})

	it('keeps the source free of characters the shell would expand', () => {
		expect(safe_chain_preinstall.LOCAL_INTEGRATION_CHECK_SOURCE).not.toMatch(/["$`]/u)
	})
})

describe('SAFE_CHAIN_CMD', () => {
	it('runs setup-ci and then the local integration check', () => {
		expect(safe_chain_preinstall.SAFE_CHAIN_CMD).toBe(
			`${LEGACY_VALUE} && ${safe_chain_preinstall.LOCAL_INTEGRATION_CHECK_CMD}`,
		)
	})

	it('is what kit itself runs, pinned version aside', () => {
		expect(read_own_preinstall()).toBe(safe_chain_preinstall.migrate_preinstall(PINNED_VALUE))
	})
})

describe('migrate_preinstall', () => {
	it('appends the check to the legacy value kit wrote', () => {
		expect(safe_chain_preinstall.migrate_preinstall(LEGACY_VALUE)).toBe(
			safe_chain_preinstall.SAFE_CHAIN_CMD,
		)
	})

	it('keeps a pinned version while appending the check', () => {
		expect(safe_chain_preinstall.migrate_preinstall(PINNED_VALUE)).toBe(
			`${PINNED_VALUE} && ${safe_chain_preinstall.LOCAL_INTEGRATION_CHECK_CMD}`,
		)
	})

	it('leaves an already migrated value unchanged', () => {
		const migrated = safe_chain_preinstall.SAFE_CHAIN_CMD

		expect(safe_chain_preinstall.migrate_preinstall(migrated)).toBe(migrated)
	})

	it('leaves a consumer-authored value unchanged', () => {
		expect(safe_chain_preinstall.migrate_preinstall(CONSUMER_VALUE)).toBe(CONSUMER_VALUE)
	})
})
