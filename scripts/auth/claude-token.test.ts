import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claude_token } from './claude-token'

const TOKEN = 'sk-ant-oat01-exampleTokenValue_1-2'
const ENVIRONMENT_TOKEN = 'sk-ant-oat01-fromTheEnvironment'
const EXECUTABLE_MODE = 0o700
const SYSTEM_PATH = '/usr/bin:/bin'
const NO_PATH = '/nonexistent'
// A keychain of one item: `-i` stores the password its stdin command carries, `find` answers from it
// and exits 44 — the "could not be found" status of the real command — when there is none.
const SECURITY = String.raw`#!/bin/sh
printf '%s\n' "$@" >> "$FAKE_DIR/argv"
if [ "$1" = "-i" ]; then
	cat > "$FAKE_DIR/stdin"
	sed -n 's/.*-w "\(.*\)"$/\1/p' "$FAKE_DIR/stdin" > "$FAKE_DIR/password"
	exit 0
fi
[ "$1" = "list-keychains" ] && exit 0
[ -s "$FAKE_DIR/password" ] || exit 44
case "$*" in
	*" -w") cat "$FAKE_DIR/password" ;;
	*) printf '%s\n' '    "mdat"<timedate>=0x32303236  "20261014071518Z\000"' ;;
esac
`
const scratch = { directory: '' }

function fake_file(name: string): string {
	return path.join(scratch.directory, name)
}

function keep(password: string): void {
	writeFileSync(fake_file('password'), password)
}

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(os.tmpdir(), 'claude-token-test-'))
	writeFileSync(fake_file('security'), SECURITY)
	chmodSync(fake_file('security'), EXECUTABLE_MODE)
	vi.stubEnv('PATH', `${scratch.directory}:${SYSTEM_PATH}`)
	vi.stubEnv('FAKE_DIR', scratch.directory)
	vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
})

afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(scratch.directory, { force: true, recursive: true })
})

describe('claude_token.read', () => {
	it('answers the keychain item first', () => {
		keep(TOKEN)
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', ENVIRONMENT_TOKEN)

		expect(claude_token.read()).toBe(TOKEN)
	})

	it('falls back to the environment when the keychain has no item', () => {
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', ENVIRONMENT_TOKEN)

		expect(claude_token.read()).toBe(ENVIRONMENT_TOKEN)
	})

	it('falls back to the environment on a machine without a keychain', () => {
		vi.stubEnv('PATH', SYSTEM_PATH.replace('/usr/bin:', ''))
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', ENVIRONMENT_TOKEN)

		expect(claude_token.read()).toBe(ENVIRONMENT_TOKEN)
	})

	it('answers undefined when neither holds a token', () => {
		expect(claude_token.read()).toBeUndefined()
	})
})

describe('claude_token.save', () => {
	it('writes the item through stdin, so the token is in no argument', () => {
		expect(claude_token.save(TOKEN)).toBe(true)

		expect(readFileSync(fake_file('stdin'), 'utf8')).toContain(`-w "${TOKEN}"`)
		expect(readFileSync(fake_file('argv'), 'utf8')).not.toContain(TOKEN)
		expect(claude_token.read()).toBe(TOKEN)
	})

	it('answers false when the item cannot be read back', () => {
		vi.stubEnv('PATH', NO_PATH)

		expect(claude_token.save(TOKEN)).toBe(false)
		expect(existsSync(fake_file('password'))).toBe(false)
	})
})

describe('claude_token.has_keychain', () => {
	it('answers true when security answers', () => {
		expect(claude_token.has_keychain()).toBe(true)
	})

	it('answers false on a machine without security', () => {
		vi.stubEnv('PATH', NO_PATH)

		expect(claude_token.has_keychain()).toBe(false)
	})
})

describe('claude_token.saved_date', () => {
	it('answers the day the item was written', () => {
		keep(TOKEN)

		expect(claude_token.saved_date()).toBe('2026-10-14')
	})

	it('answers undefined when there is no item', () => {
		expect(claude_token.saved_date()).toBeUndefined()
	})
})
