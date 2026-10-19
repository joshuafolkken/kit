import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import type { Scenario } from './eval-scenario'

// Each scenario runs against a throwaway copy of what kit distributes, never against a real
// repository. Two reasons, and both are load-bearing: `--allowed-tools` does not deny anything in
// `-p` mode — a probe confirmed the agent edited a file it was not allowed to — so the only safe
// place to observe a mutating call is a directory nobody minds losing; and a scenario has to read
// the same documents a consumer gets, or it measures the source tree instead of the distribution.

const SANDBOX_PREFIX = 'josh-eval-'

// Copied verbatim, not through the consumer rewrite: the sandbox has no `node_modules`, so a
// rewritten `prompts/…` path would point at nothing. The agent under test reads them where kit's own
// session reads them, which is the arrangement the rules were written for.
const DISTRIBUTED_PATHS: ReadonlyArray<string> = [
	'CLAUDE.md',
	'AGENTS.md',
	'GEMINI.md',
	'.claude/skills',
	'prompts',
]

// `.claude/settings.json` is copied through a filter rather than verbatim. Its `UserPromptSubmit`
// hooks are plain `echo`s carrying behavioral rules — exactly the kind of thing this suite measures,
// and they run anywhere. Its `PostToolUse` hook runs `pnpm josh format:edited`, which in a directory
// with no package.json dies with ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND and feeds that error back to the
// agent after every Edit and Write. Shipping that into the sandbox would not measure the hook; it
// would corrupt every scenario that touches a file.
const SETTINGS_PATH = '.claude/settings.json'
const TOOLCHAIN_COMMANDS = /\b(?:pnpm|npm|yarn|npx|josh)\b/u

function is_runnable_hook(hook: unknown): boolean {
	if (typeof hook !== 'object' || hook === null) return true

	const { command } = hook as { command?: unknown }

	return typeof command !== 'string' || !TOOLCHAIN_COMMANDS.test(command)
}

function filter_hook_group(group: unknown): unknown {
	if (typeof group !== 'object' || group === null) return group

	const { hooks } = group as { hooks?: unknown }

	if (!Array.isArray(hooks)) return group

	return { ...group, hooks: hooks.filter((hook) => is_runnable_hook(hook)) }
}

function filter_hook_events(hooks: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(hooks).map(([event, groups]) => [
			event,
			Array.isArray(groups) ? groups.map((group) => filter_hook_group(group)) : groups,
		]),
	)
}

function sandbox_settings(raw: string): string {
	const settings = JSON.parse(raw) as Record<string, unknown>
	const { hooks } = settings

	if (typeof hooks !== 'object' || hooks === null) return raw

	const filtered = filter_hook_events(hooks as Record<string, unknown>)

	return JSON.stringify({ ...settings, hooks: filtered }, undefined, '\t')
}

function copy_settings(destination: string): void {
	const target = path.join(destination, SETTINGS_PATH)
	const source_path = path.join(PACKAGE_DIR, SETTINGS_PATH)
	const source = readFileSync(source_path, 'utf8')

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, sandbox_settings(source))
}

function copy_distributed(destination: string): void {
	for (const relative of DISTRIBUTED_PATHS) {
		const target = path.join(destination, relative)

		mkdirSync(path.dirname(target), { recursive: true })
		cpSync(path.join(PACKAGE_DIR, relative), target, { recursive: true })
	}
}

function write_fixture_files(destination: string, scenario: Scenario): void {
	for (const [relative, contents] of Object.entries(scenario.fixture_files)) {
		const target = path.join(destination, relative)

		mkdirSync(path.dirname(target), { recursive: true })
		writeFileSync(target, contents)
	}
}

// Removed on the way out even when the run failed: a scenario that leaves its sandbox behind turns a
// suite run into a slow leak of full document copies under the temp directory.
function remove_sandbox(sandbox_path: string): void {
	rmSync(sandbox_path, { recursive: true, force: true })
}

// The directory exists before anything is copied into it, so a throw during the copy would escape
// before the caller's `try` begins and leak exactly the tree this module promises to clean up. The
// construction cleans up after itself instead of relying on a caller that is not running yet.
function create_sandbox(scenario: Scenario): string {
	const destination = mkdtempSync(path.join(tmpdir(), SANDBOX_PREFIX))

	try {
		copy_distributed(destination)
		copy_settings(destination)
		write_fixture_files(destination, scenario)
	} catch (error) {
		remove_sandbox(destination)

		throw error
	}

	return destination
}

const eval_sandbox = {
	create_sandbox,
	DISTRIBUTED_PATHS,
	remove_sandbox,
	sandbox_settings,
	SETTINGS_PATH,
}

export { eval_sandbox }
