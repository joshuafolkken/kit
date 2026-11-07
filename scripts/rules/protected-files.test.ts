import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
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

const make_directory = temporary_directory()

function settings_path_in(manifest: string | undefined): string {
	const root = make_directory('protected-files-')

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
		"bash -c 'cat .env'",
		'eval "cat .env"',
		'diff <(cat .env) x',
	])('refuses the read in %j', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})
})

// joshuafolkken/kit#6003: the tools' own credential files, wherever the home directory is spelled.
describe('protected_files.is_protected_file_call — reading a credential file', () => {
	const home = os.homedir()

	it.each([
		path.join(home, '.config', 'gh', 'hosts.yml'),
		path.join(home, '.codex', 'auth.json'),
		'/work/app/node_modules/.cache/josh/openai/reviewer-home/auth.json',
		path.join(home, '.netrc'),
		path.join(home, '.curlrc'),
		path.join(home, '.npmrc'),
		path.join(home, '.ssh', 'id_ed25519'),
	])('refuses a Read of the credential file %j', (file) => {
		const call = { name: 'Read', input: { file_path: file } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each([path.join(home, '.npmrc'), path.join(home, '.ssh'), '$CODEX_HOME/auth.json'])(
		'refuses a Grep through the credential path %j',
		(file) => {
			const call = { name: 'Grep', input: { pattern: 'token', path: file } }

			expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
		},
	)

	it('is silent on a Grep of the working tree', () => {
		const call = { name: 'Grep', input: { pattern: 'token', path: '/work/app/src' } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
	})

	it.each([
		'/work/app/.npmrc',
		'/work/app/src/auth.json',
		'/work/app/docs/hosts.yml',
		path.join(home, '.config', 'git', 'config'),
	])('is silent on a Read of the non-credential file %j', (file) => {
		const call = { name: 'Read', input: { file_path: file } }

		expect(protected_files.is_protected_file_call(call, is_consumer)).toBe(false)
	})
})

describe('protected_files.ROW — the credential files it names', () => {
	it.each(['hosts.yml', 'auth.json', '~/.netrc', '~/.ssh/**'])('names %s in its reason', (file) => {
		expect(protected_files.ROW.reason).toContain(file)
	})
})

describe('protected_files.is_protected_file_call — a credential file through Bash', () => {
	it.each([
		'cat ~/.config/gh/hosts.yml',
		'grep oauth_token "$HOME/.config/gh/hosts.yml"',
		'less ${XDG_CONFIG_HOME}/gh/hosts.yml',
		'head $CODEX_HOME/auth.json',
		'cat ${CODEX_HOME}/auth.json',
		'jq . ~/.codex/auth.json',
		'cat ~/.netrc',
		'tail ${HOME}/.curlrc',
		'cat ~/.npmrc',
		'grep -r key ~/.ssh',
		'cat ~/.ssh/id_rsa',
		'base64 < ~/.ssh/id_ed25519',
	])('refuses the credential read in %j', (command) => {
		const call = { name: 'Bash', input: { command } }

		expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(true)
	})

	it.each(['cat .npmrc', 'cat ~/.gitconfig', 'ls ~/.ssh', 'cat fixtures/auth.json'])(
		'is silent on the non-credential command %j',
		(command) => {
			const call = { name: 'Bash', input: { command } }

			expect(protected_files.is_protected_file_call(call, is_not_consumer)).toBe(false)
		},
	)
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
