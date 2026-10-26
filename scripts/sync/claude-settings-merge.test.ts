import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { json_format } from '#scripts/config-merge/json-format'
import { transform_copied_content } from '#scripts/init/init-copy-content'
import { describe, expect, it } from 'vitest'
import { claude_settings_merge } from './claude-settings-merge'

const { merge_claude_settings, WITHDRAWN_KIT_PERMISSIONS } = claude_settings_merge

interface Handler {
	type: string
	command: string
}

interface Group {
	matcher: string
	hooks: Array<Handler>
}

interface Settings {
	permissions: Record<string, unknown>
	env: Record<string, unknown>
	hooks: Record<string, Array<Group>>
	[key: string]: unknown
}

const SETTINGS_DESTINATION = '.claude/settings.json'
const KIT_LAUNCHER = 'sh ./node_modules/@joshuafolkken/kit/scripts/hooks/run-hook.sh'
const OWN_COMMAND = 'sh scripts/notify-team.sh'
const OWN_DENY = 'Bash(terraform destroy*)'
const OWN_ALLOW = 'Bash(make *)'
const KIT_DENY = 'Bash(git commit*)'
const DENY = 'deny'
const ALLOW = 'allow'
const ASK = 'ask'
const WITHDRAWN_DENY = 'Bash(git commit -a*)'
const STATUS_LINE_KEY = 'statusLine'
const STATUS_LINE = { type: 'command', command: 'sh status.sh' }
const STOP = 'Stop'
const OWN_EVENT = 'Notification'

const DISTRIBUTED = transform_copied_content(
	SETTINGS_DESTINATION,
	claude_settings_fixture.read_settings_text(),
)

function parse(content: string): Settings {
	return JSON.parse(content) as Settings
}

function group(command: string, matcher = ''): Group {
	return { matcher, hooks: [{ type: 'command', command }] }
}

// The distributed file with `edit` applied — a project's settings as they stand before a sync.
function existing_with(edit: (settings: Settings) => void): string {
	const settings = parse(DISTRIBUTED)

	edit(settings)

	return json_format.format_json(settings)
}

function add_stop_hook(settings: Settings, command: string): void {
	settings.hooks[STOP]?.push(group(command))
}

function merged_with(edit: (settings: Settings) => void): Settings {
	return parse(merge_claude_settings(existing_with(edit), DISTRIBUTED))
}

function commands(settings: Settings, event: string): Array<string> {
	return (settings.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command))
}

describe('merge_claude_settings — hooks', () => {
	it("keeps a project's own hook beside kit's on the same event", () => {
		const merged = merged_with((settings) => {
			add_stop_hook(settings, OWN_COMMAND)
		})

		expect(commands(merged, STOP)).toEqual([...commands(parse(DISTRIBUTED), STOP), OWN_COMMAND])
	})

	it("keeps a project's own hook on an event kit does not use", () => {
		const merged = merged_with((settings) => {
			settings.hooks[OWN_EVENT] = [group(OWN_COMMAND)]
		})

		expect(commands(merged, OWN_EVENT)).toEqual([OWN_COMMAND])
	})

	it("keeps a project's handler that shares a matcher group with a kit handler", () => {
		const merged = merged_with((settings) => {
			settings.hooks[STOP]?.[0]?.hooks.push({ type: 'command', command: OWN_COMMAND })
		})

		expect(commands(merged, STOP)).toEqual([...commands(parse(DISTRIBUTED), STOP), OWN_COMMAND])
	})
})

describe("merge_claude_settings — kit's hooks", () => {
	it('replaces a stale kit hook with the distributed one instead of keeping both', () => {
		const merged = merged_with((settings) => {
			settings.hooks[STOP] = [group(`${KIT_LAUNCHER} stop-guard --old-flag`)]
		})

		expect(merged.hooks[STOP]).toEqual(parse(DISTRIBUTED).hooks[STOP])
	})

	it('removes a hook kit retired, on an event kit no longer uses', () => {
		const merged = merged_with((settings) => {
			settings.hooks[OWN_EVENT] = [group(`${KIT_LAUNCHER} retired-guard`)]
		})

		expect(merged.hooks).toEqual(parse(DISTRIBUTED).hooks)
	})

	it('removes a hook kit distributed before any rewrite, as a plain pnpm josh command', () => {
		const merged = merged_with((settings) => {
			settings.hooks['PreToolUse']?.push(group('pnpm josh batch:guard', 'Bash'))
		})

		expect(merged.hooks).toEqual(parse(DISTRIBUTED).hooks)
	})

	it('removes a hook an earlier release ran through the installed dispatcher', () => {
		const legacy = 'node ./node_modules/@joshuafolkken/kit/dist/josh.js batch:guard'
		const merged = merged_with((settings) => {
			add_stop_hook(settings, legacy)
		})

		expect(merged.hooks).toEqual(parse(DISTRIBUTED).hooks)
	})
})

describe('merge_claude_settings — permissions', () => {
	it('restores a kit deny the project removed', () => {
		const merged = merged_with((settings) => {
			settings.permissions[DENY] = [OWN_DENY]
		})

		expect(merged.permissions[DENY]).toContain(KIT_DENY)
		expect(merged.permissions[DENY]).toEqual([
			...(parse(DISTRIBUTED).permissions[DENY] as Array<string>),
			OWN_DENY,
		])
	})

	it("keeps a project's own allow entry", () => {
		const merged = merged_with((settings) => {
			settings.permissions['allow'] = ['Bash(*)', OWN_ALLOW]
		})

		expect(merged.permissions['allow']).toEqual(['Bash(*)', OWN_ALLOW])
	})

	it.each(['plan', 'default', 'acceptEdits'])("keeps a project's own defaultMode: %s", (mode) => {
		const merged = merged_with((settings) => {
			settings.permissions['defaultMode'] = mode
			settings.permissions['disableBypassPermissionsMode'] = 'disable'
		})

		expect(merged.permissions['defaultMode']).toBe(mode)
		expect(merged.permissions['disableBypassPermissionsMode']).toBe('disable')
	})

	it('leaves the bypassPermissions defaultMode an earlier sync wrote as it is', () => {
		const existing = existing_with((settings) => {
			settings.permissions = { defaultMode: 'bypassPermissions', ...settings.permissions }
		})
		const merged = parse(merge_claude_settings(existing, DISTRIBUTED))

		expect(merged.permissions['defaultMode']).toBe('bypassPermissions')
		expect(merged).toEqual(parse(existing))
	})
})

describe('merge_claude_settings — permissions kit withdrew', () => {
	it("removes a withdrawn kit entry and keeps the project's own beside it", () => {
		const merged = merged_with((settings) => {
			settings.permissions[DENY] = [WITHDRAWN_DENY, OWN_DENY]
		})

		expect(merged.permissions[DENY]).toEqual([
			...(parse(DISTRIBUTED).permissions[DENY] as Array<string>),
			OWN_DENY,
		])
	})

	it('removes a withdrawn kit entry from a list kit does not ship', () => {
		const merged = merged_with((settings) => {
			settings.permissions[ASK] = [WITHDRAWN_DENY, OWN_ALLOW]
		})

		expect(merged.permissions[ASK]).toEqual([OWN_ALLOW])
	})

	it('names no entry kit still distributes', () => {
		const { permissions } = parse(DISTRIBUTED)
		const shipped = [DENY, ALLOW].flatMap((key) => permissions[key] as Array<string>)

		expect(shipped.filter((entry) => WITHDRAWN_KIT_PERMISSIONS.has(entry))).toEqual([])
	})
})

describe('merge_claude_settings — other keys', () => {
	it('keeps a top-level key kit does not ship', () => {
		const merged = merged_with((settings) => {
			settings[STATUS_LINE_KEY] = STATUS_LINE
			settings['enableArtifact'] = false
		})

		expect(merged[STATUS_LINE_KEY]).toEqual(STATUS_LINE)
		expect(merged['enableArtifact']).toBe(false)
	})

	it("keeps a project's own entry inside an object kit ships, with kit's entries winning", () => {
		const merged = merged_with((settings) => {
			settings.env = { BASH_MAX_OUTPUT_LENGTH: '1', TEAM_REGION: 'tokyo' }
		})

		expect(merged.env).toEqual({ ...parse(DISTRIBUTED).env, TEAM_REGION: 'tokyo' })
	})
})

describe('merge_claude_settings — the whole file', () => {
	it('returns the distributed content unchanged when the project added nothing', () => {
		expect(merge_claude_settings(DISTRIBUTED, DISTRIBUTED)).toBe(DISTRIBUTED)
	})

	it('returns the distributed content for a file holding only stale kit entries', () => {
		const existing = existing_with((settings) => {
			settings.hooks = { [STOP]: [group(`${KIT_LAUNCHER} retired-guard`)] }
			settings.permissions = { deny: [KIT_DENY] }
		})

		expect(merge_claude_settings(existing, DISTRIBUTED)).toBe(DISTRIBUTED)
	})

	it('changes nothing on a second merge', () => {
		const existing = existing_with((settings) => {
			add_stop_hook(settings, OWN_COMMAND)
			settings.permissions[DENY] = [OWN_DENY]
			settings[STATUS_LINE_KEY] = STATUS_LINE
		})
		const once = merge_claude_settings(existing, DISTRIBUTED)

		expect(merge_claude_settings(once, DISTRIBUTED)).toBe(once)
	})

	it.each(['', '{ not json', '[]'])('replaces a file that is not a JSON object: %j', (existing) => {
		expect(merge_claude_settings(existing, DISTRIBUTED)).toBe(DISTRIBUTED)
	})
})
