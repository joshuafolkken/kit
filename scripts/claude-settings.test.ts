import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SETTINGS_PATH = fileURLToPath(new URL('../.claude/settings.json', import.meta.url))
const GITIGNORE_PATH = fileURLToPath(new URL('../.gitignore', import.meta.url))

/* eslint-disable @typescript-eslint/naming-convention */
interface PermissionsBlock {
	defaultMode: string
	allow: ReadonlyArray<string>
	deny: ReadonlyArray<string>
}
/* eslint-enable @typescript-eslint/naming-convention */

interface SettingsShape {
	permissions: PermissionsBlock
}

function load_settings(): SettingsShape {
	const raw = readFileSync(SETTINGS_PATH, 'utf8')

	return JSON.parse(raw) as SettingsShape
}

const REQUIRED_DENY_PATTERNS: ReadonlyArray<string> = [
	'Bash(rm -rf *)',
	'Bash(rm -rf /*)',
	'Bash(git push --force*)',
	'Bash(git push -f*)',
	'Bash(sudo *)',
]

describe('.claude/settings.json — permissions', () => {
	it('keeps defaultMode set to bypassPermissions', () => {
		const settings = load_settings()

		expect(settings.permissions.defaultMode).toBe('bypassPermissions')
	})

	it('allows all Bash commands via wildcard so per-command entries do not accumulate', () => {
		const settings = load_settings()

		expect(settings.permissions.allow).toContain('Bash(*)')
	})

	it.each(REQUIRED_DENY_PATTERNS)('blocks dangerous pattern %s in deny list', (pattern) => {
		const settings = load_settings()

		expect(settings.permissions.deny).toContain(pattern)
	})
})

describe('.gitignore — Claude Code runtime artifacts', () => {
	it('ignores .claude/scheduled_tasks.lock so it never lands in commits', () => {
		const gitignore = readFileSync(GITIGNORE_PATH, 'utf8')

		expect(gitignore).toMatch(/^\.claude\/scheduled_tasks\.lock$/mu)
	})
})
