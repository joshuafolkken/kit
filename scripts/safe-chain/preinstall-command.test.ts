import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { safe_chain_preinstall } from './preinstall-command'

const PROXY_URL = 'http://127.0.0.1:49681'
const LEGACY_VALUE = 'pnpm dlx @aikidosec/safe-chain setup-ci'
const PINNED_VALUE = 'pnpm dlx @aikidosec/safe-chain@1.5.20 setup-ci'
const EARLIER_CHECK = `node -e "if(!process.env.CI)console.warn('Warning: safe-chain is not scanning this install.')"`
const CONSUMER_VALUE = 'npx only-allow pnpm'
const CHECKED_VARIABLES: ReadonlySet<string> = new Set(['CI', 'GLOBAL_AGENT_HTTP_PROXY'])
// A command that reaches the network to fetch something before running it.
const NETWORK_FETCH_RE = /\b(?:dlx|npx|curl|wget|exec)\b/u
const PNPMFILE_URL = new URL('../../.pnpmfile.mjs', import.meta.url).href

interface CheckResult {
	status: number | null
	stderr: string
}

interface PnpmfileModule {
	is_safe_chain_preinstall: (name: string, command: string) => boolean
}

const { is_safe_chain_preinstall } = (await import(PNPMFILE_URL)) as PnpmfileModule

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
	it('runs only the local integration check', () => {
		expect(safe_chain_preinstall.SAFE_CHAIN_CMD).toBe(
			`node -e "${safe_chain_preinstall.LOCAL_INTEGRATION_CHECK_SOURCE}"`,
		)
	})

	// joshuafolkken/kit#3269: the install used to fetch and run an unverified safe-chain every time.
	it('fetches nothing from the network', () => {
		expect(safe_chain_preinstall.SAFE_CHAIN_CMD).not.toMatch(NETWORK_FETCH_RE)
	})

	it('is what kit itself runs', () => {
		expect(read_own_preinstall()).toBe(safe_chain_preinstall.SAFE_CHAIN_CMD)
	})

	it('is still stripped from a packed manifest by the pnpmfile hook', () => {
		expect(is_safe_chain_preinstall('preinstall', safe_chain_preinstall.SAFE_CHAIN_CMD)).toBe(true)
	})
})

describe('migrate_preinstall', () => {
	it.each([
		['the unpinned setup-ci', LEGACY_VALUE],
		['a pinned setup-ci', PINNED_VALUE],
		['setup-ci followed by an earlier check', `${PINNED_VALUE} && ${EARLIER_CHECK}`],
	])('replaces %s with the network-free check', (_label, value) => {
		expect(safe_chain_preinstall.migrate_preinstall(value)).toBe(
			safe_chain_preinstall.SAFE_CHAIN_CMD,
		)
	})

	it('leaves an already migrated value unchanged', () => {
		const migrated = safe_chain_preinstall.SAFE_CHAIN_CMD

		expect(safe_chain_preinstall.migrate_preinstall(migrated)).toBe(migrated)
	})

	it.each([
		['a consumer-authored value', CONSUMER_VALUE],
		['setup-ci chained with a consumer command', `${LEGACY_VALUE} && ${CONSUMER_VALUE}`],
	])('leaves %s unchanged', (_label, value) => {
		expect(safe_chain_preinstall.migrate_preinstall(value)).toBe(value)
	})
})
