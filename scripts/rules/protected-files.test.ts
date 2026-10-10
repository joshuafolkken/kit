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
		'/work/app/.env',
		'/work/app/.env.local',
		'/work/app/apps/web/.env.production',
		'/work/app/.dev.vars',
	])('refuses a Read of %j', (file) => {
		const call = { name: 'Read', input: { file_path: file } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each(['/work/app/.env.example', '/work/app/.env.test', '/work/app/src/env.ts'])(
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
