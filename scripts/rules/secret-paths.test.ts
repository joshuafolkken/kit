import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { secret_paths } from './secret-paths'

// joshuafolkken/kit#6003: which words name a secret — the dotenv files by name anywhere, the tool
// credentials by the path's end, and the home dotfiles only under the home directory.

const home = os.homedir()

describe('secret_paths.is_secret_path', () => {
	it.each([
		'.env',
		'"apps/web/.env.local"',
		'.dev.vars',
		'/x/.config/gh/hosts.yml',
		'$XDG_CONFIG_HOME/gh/hosts.yml',
		'~/.codex/auth.json',
		'$CODEX_HOME/auth.json',
		'${CODEX_HOME}/auth.json',
		'node_modules/.cache/josh/openai/reviewer-home/auth.json',
		'~/.netrc',
		'$HOME/.curlrc',
		'${HOME}/.npmrc',
		'~/.ssh',
		path.join(home, '.ssh', 'config'),
		path.join(home, '.config', 'gh', 'config.yml'),
	])('names a secret in %j', (word) => {
		expect(secret_paths.is_secret_path(word)).toBe(true)
	})

	it.each([
		'.env.example',
		'.env.test',
		'.npmrc',
		'/work/app/.netrc',
		'auth.json',
		'src/auth.json',
		'not-gh/hosts.yml',
		'~/.sshd/x',
		path.join(home, '.config', 'ghost', 'x'),
	])('names no secret in %j', (word) => {
		expect(secret_paths.is_secret_path(word)).toBe(false)
	})
})
