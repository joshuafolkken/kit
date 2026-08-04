import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { sync_configs } from './sync-configs'

const UNCHANGED_LABEL = 'unchanged'
const HOME_NPMRC = '~/.npmrc'
// A builder outside GitHub Actions has no ~/.npmrc to fall back on, so the notice has to name
// its destination too — its 401 lands at deploy time, where no CI check sees it (#746). The
// section anchor is asserted, not the file: the docs link alone was already there.
const BUILDER_PLATFORM = 'Cloudflare'
const BUILDER_DESTINATION = 'docs/authentication.md §4'
const NPMRC_UP_TO_DATE = init_logic.generate_npmrc()
// The credential line the kit used to distribute: pnpm >= 11.6 ignores it in a project .npmrc,
// so sync removes it instead of re-adding it (#711).
const NPMRC_WITH_OBSOLETE_AUTH_LINE = `${NPMRC_UP_TO_DATE}//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}\n`

const ctx = { work_directory: '', destination: '' }

beforeEach(() => {
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'sync-configs-npmrc-'))
	ctx.destination = path.join(ctx.work_directory, '.npmrc')
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function spy_console_info(): MockInstance<typeof console.info> {
	return vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
}

describe('sync_configs.sync_npmrc', () => {
	it('does nothing when .npmrc does not exist', () => {
		sync_configs.sync_npmrc(ctx.destination)

		expect(existsSync(ctx.destination)).toBe(false)
	})

	it('logs unchanged when all required lines present', () => {
		writeFileSync(ctx.destination, NPMRC_UP_TO_DATE)
		const info_spy = spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(UNCHANGED_LABEL))
	})

	it('appends missing lines when outdated', () => {
		writeFileSync(ctx.destination, 'engine-strict=true\n')
		spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(readFileSync(ctx.destination, 'utf8')).toContain('confirmModulesPurge=false')
	})
})

describe('sync_configs.sync_npmrc — obsolete auth line', () => {
	it('removes the auth token line pnpm ignores in a project .npmrc', () => {
		writeFileSync(ctx.destination, NPMRC_WITH_OBSOLETE_AUTH_LINE)
		spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(readFileSync(ctx.destination, 'utf8')).toBe(NPMRC_UP_TO_DATE)
	})

	it('tells the user where the credential belongs after removing it', () => {
		writeFileSync(ctx.destination, NPMRC_WITH_OBSOLETE_AUTH_LINE)
		const info_spy = spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(HOME_NPMRC))
	})

	it('points builders with no user-level npmrc at the setup docs', () => {
		writeFileSync(ctx.destination, NPMRC_WITH_OBSOLETE_AUTH_LINE)
		const info_spy = spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(BUILDER_PLATFORM))
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(BUILDER_DESTINATION))
	})

	it('stays quiet about the credential when no obsolete line was present', () => {
		writeFileSync(ctx.destination, NPMRC_UP_TO_DATE)
		const info_spy = spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(info_spy).not.toHaveBeenCalledWith(expect.stringContaining(HOME_NPMRC))
	})
})
