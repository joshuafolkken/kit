import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths_mock = vi.hoisted(() => ({ root: '' }))
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

vi.mock('#scripts/init/init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
	PACKAGE_DIR: REPOSITORY_ROOT,
	package_path: (relative_path: string): string => path.join(REPOSITORY_ROOT, relative_path),
}))

interface Group {
	matcher: string
	hooks: Array<{ type: string; command: string }>
}

interface Settings {
	permissions: { deny: Array<string> }
	hooks: Record<string, Array<Group>>
	statusLine?: unknown
}

const SETTINGS_FILE = '.claude/settings.json'
const OWN_COMMAND = 'sh scripts/notify-team.sh'
const OWN_DENY = 'Bash(terraform destroy*)'
const KIT_DENY = 'Bash(git commit*)'
const KIT_LAUNCHER = 'sh ./node_modules/@joshuafolkken/kit/scripts/hooks/run-hook.sh'
const STATUS_LINE = { type: 'command', command: 'sh status.sh' }
const OWN_SETTINGS = {
	permissions: { deny: [OWN_DENY] },
	statusLine: STATUS_LINE,
	hooks: {
		Stop: [
			{ matcher: '', hooks: [{ type: 'command', command: `${KIT_LAUNCHER} retired-guard` }] },
			{ matcher: '', hooks: [{ type: 'command', command: OWN_COMMAND }] },
		],
	},
}

function settings_path(): string {
	return path.join(paths_mock.root, SETTINGS_FILE)
}

function read_settings_text(): string {
	return readFileSync(settings_path(), 'utf8')
}

function read_settings(): Settings {
	return JSON.parse(read_settings_text()) as Settings
}

function stop_commands(): Array<string> {
	return (read_settings().hooks['Stop'] ?? []).flatMap((group) =>
		group.hooks.map((hook) => hook.command),
	)
}

async function run_sync(is_force = false): Promise<void> {
	const { sync_ai_files } = await import('./sync-ai-files')

	sync_ai_files.sync_ai_copy_all(is_force)
}

async function distributed_settings_text(): Promise<string> {
	await run_sync(true)

	return read_settings_text()
}

function write_own_settings(): void {
	mkdirSync(path.dirname(settings_path()), { recursive: true })
	writeFileSync(settings_path(), JSON.stringify(OWN_SETTINGS))
}

beforeEach(() => {
	paths_mock.root = mkdtempSync(path.join(tmpdir(), 'sync-claude-settings-'))
	writeFileSync(
		path.join(paths_mock.root, 'package.json'),
		JSON.stringify({ private: true, josh: { profile: 'full' } }),
	)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
	vi.spyOn(console, 'warn').mockReturnValue(undefined)
})

afterEach(() => {
	rmSync(paths_mock.root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('josh sync on a .claude/settings.json the project has added to', () => {
	it("keeps the project's hook, deny entry and own key", async () => {
		write_own_settings()
		await run_sync()

		expect(stop_commands()).toContain(OWN_COMMAND)
		expect(read_settings().permissions.deny).toContain(OWN_DENY)
		expect(read_settings().statusLine).toEqual(STATUS_LINE)
	})

	it("writes kit's hooks and deny list, and drops the retired kit hook", async () => {
		write_own_settings()
		await run_sync()

		expect(stop_commands().map((command) => command.split(KIT_LAUNCHER).at(-1))).toEqual([
			' stop-guard',
			OWN_COMMAND,
		])
		expect(read_settings().permissions.deny).toContain(KIT_DENY)
	})

	it('leaves the file as it is on a second sync', async () => {
		write_own_settings()
		await run_sync()
		const once = read_settings_text()

		await run_sync()

		expect(read_settings_text()).toBe(once)
	})

	it('replaces the file with the distributed one under --force', async () => {
		const distributed = await distributed_settings_text()

		write_own_settings()
		await run_sync(true)

		expect(read_settings_text()).toBe(distributed)
	})
})

describe('josh sync on a .claude/settings.json with nothing of the project in it', () => {
	it('writes the distributed content when the file is absent', async () => {
		const distributed = await distributed_settings_text()

		rmSync(settings_path())
		await run_sync()

		expect(read_settings_text()).toBe(distributed)
	})

	it('reports the distributed file as unchanged', async () => {
		const distributed = await distributed_settings_text()

		await run_sync()

		expect(read_settings_text()).toBe(distributed)
		expect(console.info).toHaveBeenCalledWith(`  ✔ unchanged ${SETTINGS_FILE}`)
	})
})
