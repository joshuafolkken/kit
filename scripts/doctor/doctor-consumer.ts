import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { z } from 'zod'

// The consumer-setup checks `josh doctor` runs in a repository that installs kit.
// Each failure was a way the distribution went silently wrong: the plugin never installed so skills
// were missing, `core.hooksPath` set so lefthook installed nothing, the `CLAUDE.md` pointer resolving
// to a file that is not there before `pnpm install`, and secretlint not runnable so the pre-commit
// hook could not scan. Each check prints a one-line verdict; none of them fails the command.

const NODE_MODULES = 'node_modules'
const SETTINGS_PATH = path.join('.claude', 'settings.json')
const CLAUDE_MD = 'CLAUDE.md'
const PLUGIN_ID = 'kit@kit'
// The one line a consumer's CLAUDE.md is: an import of the packaged rules. kit's own CLAUDE.md is the
// full document, so this pointer is also what tells a consumer repository apart from kit itself.
const CLAUDE_MD_POINTER = `@${NODE_MODULES}/${KIT_PACKAGE_NAME}/dist/${CLAUDE_MD}`
const SECRETLINT_BIN = path.join(NODE_MODULES, '.bin', 'secretlint')

const manifest_schema = z.object({
	name: z.string().optional(),
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
})
const settings_schema = z.object({
	enabledPlugins: z.record(z.string(), z.boolean()).optional(),
})
type ManifestShape = z.infer<typeof manifest_schema>
const STATE_OK = 'ok'
const STATE_TARGET_MISSING = 'target-missing'
const STATE_MISSING = 'missing'
type ClaudeMdState = typeof STATE_OK | typeof STATE_TARGET_MISSING | typeof STATE_MISSING

function parse_manifest(root: string): ManifestShape | undefined {
	const content = file_reader.read_if_readable(path.join(root, 'package.json'))
	if (content === undefined) return undefined
	const parsed = manifest_schema.safeParse(json_value.parse_or_undefined(content))

	return parsed.success ? parsed.data : undefined
}

function lists_kit_dependency(manifest: ManifestShape | undefined): boolean {
	if (manifest === undefined) return false

	return (
		Object.hasOwn(manifest.dependencies ?? {}, KIT_PACKAGE_NAME) ||
		Object.hasOwn(manifest.devDependencies ?? {}, KIT_PACKAGE_NAME)
	)
}

// Whether this repository consumes kit rather than being kit itself. kit is excluded by its own
// package name; a consumer either declares the dependency or already has it installed, so a fresh
// clone before `pnpm install` (which declares it) still counts.
function is_kit_consumer(root: string): boolean {
	const manifest = parse_manifest(root)
	if (manifest?.name === KIT_PACKAGE_NAME) return false

	return (
		lists_kit_dependency(manifest) || existsSync(path.join(root, NODE_MODULES, KIT_PACKAGE_NAME))
	)
}

function is_plugin_declared(root: string): boolean {
	const content = file_reader.read_if_readable(path.join(root, SETTINGS_PATH))
	if (content === undefined) return false
	const parsed = settings_schema.safeParse(json_value.parse_or_undefined(content))

	return parsed.success && parsed.data.enabledPlugins?.[PLUGIN_ID] === true
}

// The value of `core.hooksPath`, or undefined when it is unset. A set value is what stops lefthook
// from installing kit's git hooks — the failure is silent but for one stderr line.
function configured_hooks_path(root: string): string | undefined {
	const value = git_spawn_sync.read(['-C', root, 'config', '--get', 'core.hooksPath'], {
		timeout: PROBE_TIMEOUT_MS,
	})

	return value === '' ? undefined : value
}

function claude_md_state(root: string): ClaudeMdState {
	const content = file_reader.read_if_readable(path.join(root, CLAUDE_MD))
	if (content === undefined) return STATE_MISSING
	if (!content.includes(CLAUDE_MD_POINTER)) return STATE_OK

	return existsSync(path.join(root, NODE_MODULES, KIT_PACKAGE_NAME, 'dist', CLAUDE_MD))
		? STATE_OK
		: STATE_TARGET_MISSING
}

function is_secretlint_runnable(root: string): boolean {
	return existsSync(path.join(root, SECRETLINT_BIN))
}

function status_line(is_ok: boolean, ok_text: string, warn_text: string): string {
	return is_ok ? `  ✓ ${ok_text}` : `  ⚠ ${warn_text}`
}

function plugin_line(is_declared: boolean): string {
	return status_line(
		is_declared,
		'kit plugin declared (skills load in a trusted workspace; headless from its second session)',
		'kit plugin not declared in .claude/settings.json — run `pnpm josh sync`',
	)
}

function hooks_path_line(hooks_path: string | undefined): string {
	return status_line(
		hooks_path === undefined,
		'git hooks install normally (core.hooksPath unset)',
		`core.hooksPath is set (${hooks_path ?? ''}) — lefthook installs no git hooks; unset it`,
	)
}

function claude_md_line(state: ClaudeMdState): string {
	if (state === STATE_OK) return '  ✓ CLAUDE.md resolves to the installed kit rules'

	if (state === STATE_TARGET_MISSING) {
		return '  ⚠ CLAUDE.md points at rules that are not installed — run `pnpm install`'
	}

	return '  ⚠ CLAUDE.md is missing — run `pnpm josh init`'
}

function secretlint_line(is_runnable: boolean): string {
	return status_line(
		is_runnable,
		'secretlint is runnable',
		'secretlint is not installed — run `pnpm install`',
	)
}

function consumer_setup_lines(root: string): ReadonlyArray<string> {
	return [
		plugin_line(is_plugin_declared(root)),
		hooks_path_line(configured_hooks_path(root)),
		claude_md_line(claude_md_state(root)),
		secretlint_line(is_secretlint_runnable(root)),
	]
}

// Printed only in a repository that consumes kit, so kit's own `josh doctor` stays quiet about it.
function report_consumer_setup(root: string): void {
	if (!is_kit_consumer(root)) return

	console.info('')
	console.info('Consumer setup:')
	for (const line of consumer_setup_lines(root)) console.info(line)
}

const doctor_consumer = {
	claude_md_line,
	claude_md_state,
	configured_hooks_path,
	hooks_path_line,
	is_kit_consumer,
	is_plugin_declared,
	is_secretlint_runnable,
	plugin_line,
	report_consumer_setup,
	secretlint_line,
}

export type { ClaudeMdState }
export { doctor_consumer }
