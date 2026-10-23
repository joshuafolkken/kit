import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { protected_files } from './protected-files'

// joshuafolkken/kit#2983: the file tools a run must not point at `.env` (Read) or at a consumer's
// `.claude/settings.json` (Edit / Write). The consumer check is injected, so the settings branch is
// decided per repository without touching the filesystem; the last block runs the real check.

const SETTINGS_PATH = '/work/app/.claude/settings.json'
const KIT = '@joshuafolkken/kit'
const ENV_PATH = '/work/app/.env'
const EXAMPLE_PATH = '/work/app/.env.example'

function is_consumer(): boolean {
	return true
}

function is_not_consumer(): boolean {
	return false
}

function settings_path_in(manifest: string | undefined): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'protected-files-'))

	if (manifest !== undefined) writeFileSync(path.join(root, 'package.json'), manifest)

	return path.join(root, '.claude', 'settings.json')
}

describe('protected_files.is_protected_file_call — .env', () => {
	it.each([
		ENV_PATH,
		'/work/app/.env.local',
		'/work/app/apps/web/.env.production',
		'/work/app/.dev.vars',
	])('refuses a Read of %j', (file) => {
		const call = { name: 'Read', input: { file_path: file } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each([EXAMPLE_PATH, '/work/app/.env.test', '/work/app/src/env.ts'])(
		'is silent on a Read of %j',
		(file) => {
			const call = { name: 'Read', input: { file_path: file } }

			expect(protected_files.is_protected_file_call(call, is_consumer)).toBe(false)
		},
	)
})

describe('protected_files.is_protected_file_call — .env through Bash', () => {
	it.each([
		'cat .env',
		'head -n 3 /work/app/.env',
		'grep TOKEN ".env"',
		'source .env && pnpm dev',
		'. ./.env',
		'git status; sed -n 1p .env',
		'wc -l < .env',
		'grep KEY .env.local',
		'source .env.production && pnpm dev',
		'cat .dev.vars',
	])('refuses %j', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each([
		'cat .env.example',
		'source .env.test',
		'git add .env.example',
		'git commit -m "Ignore .env"',
		'ls -a',
	])('is silent on %j', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
	})
})

// joshuafolkken/kit#4038: the readers the set lacked, a path-spelled reader, and a pipe or `&` in front.
describe('protected_files.is_protected_file_call — the wider readers', () => {
	it.each([
		'base64 .env',
		'jq . .env',
		'diff .env .env.example',
		'cmp .env .env.example',
		'hexdump -C .env',
		'perl -pe 1 .env',
		'/bin/cat .env',
		'true | cat .env',
		'x & cat .env',
	])('refuses the read in %j', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})
})

// joshuafolkken/kit#4660: a write to `.env` could set a guard switch, so it is refused like a read.
describe('protected_files.is_protected_file_call — writing .env', () => {
	it.each(['Edit', 'Write'])('refuses a %s of .env', (name) => {
		const call = { name, input: { file_path: ENV_PATH } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each(['Edit', 'Write'])('lets a %s of .env.example through', (name) => {
		const call = { name, input: { file_path: EXAMPLE_PATH } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
	})
})

// A quoted `>` is text, except in the script a shell runs.
describe('protected_files.is_protected_file_call — writing .env through Bash', () => {
	it.each([
		'echo JOSH_RULE_GUARD=off >> .env',
		'echo JOSH_RULE_GUARD=off>.env',
		'printf x > /work/app/.env.local',
		'echo x | tee -a .env',
		'cp .env.example .env',
		'mv .env.local.bak .env.local',
		'ln -sf /tmp/x .env',
		'install -m 600 /tmp/x .dev.vars',
		'cat > .env <<EOF',
		'echo x > ".env"',
		'sh -c "echo x > .env"',
		'bash -c "true; cat .env"',
		'sh -c "true && cp .env.example .env"',
		'eval "x; tee .env"',
	])('refuses the write in %j', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each([
		'echo x > .env.example',
		'pnpm test 2>&1',
		'cp .env.example /tmp/copy',
		'git commit -m "x >> .env"',
		'gh pr create --body "Refuses echo JOSH_RULE_GUARD=off >> .env; cat .env"',
	])('lets %j through', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
	})
})

// The clobber `>|` is a redirect, not a pipe; a command substitution runs even inside double quotes.
describe('protected_files.is_protected_file_call — clobber and command substitution', () => {
	it.each(['echo JOSH_RULE_GUARD=off >| .env', 'echo "$(echo x > .env)"', 'echo "`cat .env`"'])(
		'refuses the hidden write or read in %j',
		(command) => {
			const call = { name: 'Bash', input: { command } }

			expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
		},
	)

	it.each(['echo x >| /tmp/out', 'echo "$(date) > .env is text"'])('lets %j pass', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
	})
})

describe('protected_files.is_protected_file_call — .claude/settings.json', () => {
	it.each(['Edit', 'Write'])('refuses a consumer %s', (name) => {
		const call = { name, input: { file_path: SETTINGS_PATH } }

		expect(protected_files.is_protected_file_call(call, is_consumer)).toBe(true)
	})

	it('lets a repository that is not a consumer edit its settings', () => {
		const call = { name: 'Edit', input: { file_path: SETTINGS_PATH } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
	})

	it('is silent on a Read of the settings and on other files', () => {
		const read = { name: 'Read', input: { file_path: SETTINGS_PATH } }
		const local = { name: 'Edit', input: { file_path: '/work/app/.claude/settings.local.json' } }

		expect(protected_files.is_protected_file_call(read, is_consumer)).toBe(false)
		expect(protected_files.is_protected_file_call(local, is_consumer)).toBe(false)
	})
})

describe('protected_files.is_protected_file_call — the real consumer check', () => {
	it('refuses an edit in a repository that declares kit', () => {
		const manifest = JSON.stringify({ devDependencies: { [KIT]: '^1.0.0' } })
		const call = { name: 'Edit', input: { file_path: settings_path_in(manifest) } }

		expect(protected_files.is_protected_file_call(call)).toBe(true)
	})

	it('lets kit itself edit the settings it distributes', () => {
		const manifest = JSON.stringify({ name: KIT })
		const call = { name: 'Edit', input: { file_path: settings_path_in(manifest) } }

		expect(protected_files.is_protected_file_call(call)).toBe(false)
	})

	it('lets the user-level settings, which sit in no repository, be edited', () => {
		const call = { name: 'Edit', input: { file_path: settings_path_in(undefined) } }

		expect(protected_files.is_protected_file_call(call)).toBe(false)
	})
})
