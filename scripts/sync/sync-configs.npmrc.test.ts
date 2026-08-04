import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { sync_configs } from './sync-configs'

const UNCHANGED_LABEL = 'unchanged'
const HOME_NPMRC = '~/.npmrc'
const NPMRC_UP_TO_DATE = init_logic.generate_npmrc()
const PURGE_LINE = 'confirmModulesPurge=false'
// The kit does not distribute this line, but a consumer may keep it: with `npmrcAuthFile`
// pointing at the project .npmrc, pnpm expands it and it is the only credential the deploy
// build has. Sync removed it until #759, which took down a working Cloudflare deploy.
const AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n'
const NPMRC_WITH_AUTH_LINE = `${NPMRC_UP_TO_DATE}${AUTH_LINE}`

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
		expect(readFileSync(ctx.destination, 'utf8')).toContain(PURGE_LINE)
	})
})

describe('sync_configs.sync_npmrc — consumer auth line', () => {
	it('leaves the auth token line in place', () => {
		writeFileSync(ctx.destination, NPMRC_WITH_AUTH_LINE)
		spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(readFileSync(ctx.destination, 'utf8')).toBe(NPMRC_WITH_AUTH_LINE)
	})

	it('reports unchanged rather than rewriting the file', () => {
		writeFileSync(ctx.destination, NPMRC_WITH_AUTH_LINE)
		const info_spy = spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(UNCHANGED_LABEL))
	})

	it('never tells the user to move the credential elsewhere', () => {
		writeFileSync(ctx.destination, NPMRC_WITH_AUTH_LINE)
		const info_spy = spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		expect(info_spy).not.toHaveBeenCalledWith(expect.stringContaining(HOME_NPMRC))
	})

	it('keeps the auth line while appending the missing required lines', () => {
		writeFileSync(ctx.destination, AUTH_LINE)
		spy_console_info()

		sync_configs.sync_npmrc(ctx.destination)
		const result = readFileSync(ctx.destination, 'utf8')

		expect(result).toContain(AUTH_LINE)
		expect(result).toContain(PURGE_LINE)
	})
})
