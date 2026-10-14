import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth_setup_cli } from './auth-setup-cli'
import { claude_token } from './claude-token'

vi.mock('./claude-token', () => ({
	claude_token: {
		save: vi.fn(),
		saved_date: vi.fn(),
		has_keychain: vi.fn(),
		VARIABLE: 'CLAUDE_CODE_OAUTH_TOKEN',
		SETUP_HINT: 'Run `pnpm josh auth:setup` to save one.',
	},
}))

const TOKEN = 'sk-ant-oat01-exampleTokenValue_1-2'
const EXECUTABLE_MODE = 0o700
const SYSTEM_PATH = '/usr/bin:/bin'
// `claude setup-token` as the browser sign-in ends it: the token printed between two lines of prose.
const CLAUDE = String.raw`#!/bin/sh
printf '%s\n' "$@" > "$FAKE_DIR/argv"
printf '%s\n' 'Token created.' "$FAKE_PRINTED" 'Store this token securely.'
exit "$FAKE_EXIT"
`
const scratch = { directory: '' }

function printed(stream: typeof console.info): string {
	return vi.mocked(stream).mock.calls.flat().join('\n')
}

function written(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map(([chunk]) => String(chunk))
		.join('')
}

function everything_printed(): string {
	return `${written()}\n${printed(console.info)}\n${printed(console.error)}`
}

function install_claude(): void {
	scratch.directory = mkdtempSync(path.join(os.tmpdir(), 'auth-setup-cli-test-'))
	writeFileSync(path.join(scratch.directory, 'claude'), CLAUDE)
	chmodSync(path.join(scratch.directory, 'claude'), EXECUTABLE_MODE)
	vi.stubEnv('PATH', `${scratch.directory}:${SYSTEM_PATH}`)
	vi.stubEnv('FAKE_DIR', scratch.directory)
	vi.stubEnv('FAKE_PRINTED', TOKEN)
	vi.stubEnv('FAKE_EXIT', '0')
}

beforeEach(() => {
	install_claude()
	vi.mocked(claude_token.save).mockReturnValue(true)
	vi.mocked(claude_token.has_keychain).mockReturnValue(true)
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetAllMocks()
	vi.restoreAllMocks()
	rmSync(scratch.directory, { force: true, recursive: true })
})

describe('auth_setup_cli.run — saving the token', () => {
	it('saves the token claude setup-token printed and says where', async () => {
		await expect(auth_setup_cli.run([])).resolves.toBe(0)

		expect(claude_token.save).toHaveBeenCalledWith(TOKEN)
		expect(printed(console.info)).toContain('saved: CLAUDE_CODE_OAUTH_TOKEN (macOS keychain)')
	})

	it('shows the output of claude with the token replaced', async () => {
		await auth_setup_cli.run([])

		expect(written()).toBe('Token created.\n[REDACTED]\nStore this token securely.\n')
		expect(everything_printed()).not.toContain(TOKEN)
	})

	it('shows what claude printed before the token as it arrives, apart from the rest', async () => {
		await auth_setup_cli.run([])

		expect(vi.mocked(process.stdout.write).mock.calls[0]?.[0]).toBe('Token created.\n')
	})

	it('saves nothing when claude printed no token', async () => {
		vi.stubEnv('FAKE_PRINTED', '')

		await expect(auth_setup_cli.run([])).resolves.toBe(1)
		expect(claude_token.save).not.toHaveBeenCalled()
		expect(printed(console.error)).toContain('printed no token')
	})

	it('saves nothing when claude setup-token failed', async () => {
		vi.stubEnv('FAKE_EXIT', '1')

		await expect(auth_setup_cli.run([])).resolves.toBe(1)
		expect(claude_token.save).not.toHaveBeenCalled()
		expect(everything_printed()).not.toContain(TOKEN)
	})
})

describe('auth_setup_cli.run — the keychain', () => {
	it('runs no sign-in on a machine without a keychain, and points at the variable', async () => {
		vi.mocked(claude_token.has_keychain).mockReturnValue(false)

		await expect(auth_setup_cli.run([])).resolves.toBe(1)
		expect(existsSync(path.join(scratch.directory, 'argv'))).toBe(false)
		expect(printed(console.error)).toContain('export CLAUDE_CODE_OAUTH_TOKEN')
	})

	it('says to run again when the keychain did not keep the token', async () => {
		vi.mocked(claude_token.save).mockReturnValue(false)

		await expect(auth_setup_cli.run([])).resolves.toBe(1)
		expect(printed(console.error)).toContain('did not keep the token')
		expect(everything_printed()).not.toContain(TOKEN)
	})
})

describe('auth_setup_cli.run — --check', () => {
	it('answers ok and the day the token was saved, running no claude', async () => {
		vi.mocked(claude_token.saved_date).mockReturnValue('2026-10-14')

		await expect(auth_setup_cli.run(['--check'])).resolves.toBe(0)
		expect(printed(console.info)).toBe(
			'ok: CLAUDE_CODE_OAUTH_TOKEN saved on 2026-10-14 (macOS keychain)',
		)
	})

	it('answers missing and names auth:setup when none is saved', async () => {
		vi.mocked(claude_token.saved_date).mockReturnValue(undefined)

		await expect(auth_setup_cli.run(['--check'])).resolves.toBe(1)
		expect(printed(console.error)).toContain('missing: no CLAUDE_CODE_OAUTH_TOKEN saved')
		expect(printed(console.error)).toContain('pnpm josh auth:setup')
	})
})
