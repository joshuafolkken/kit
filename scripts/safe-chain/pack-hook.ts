import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'
import { file_content } from '#scripts/sync/file-content'
import { z } from 'zod'

// kit writes the Safe Chain `preinstall` into every project it sets up, and a package that publishes
// would ship it: the consumer's pnpm then refuses it as an unapproved build script and `pnpm add`
// exits 1. kit's own `.pnpmfile.mjs` strips it at pack time,
// so that one file is what a publishing project receives — never a copy of
// its logic.
//
// A private package is left alone: it never packs, and a new pnpmfile changes the lockfile's
// `pnpmfileChecksum`, which fails a frozen install until the lockfile is refreshed.
const PACK_HOOK_FILE = '.pnpmfile.mjs'
const MANAGED_LINE = '// josh-managed-pnpmfile: @joshuafolkken/kit'
const MANIFEST_FILE = 'package.json'
// pnpm loads `.pnpmfile.mjs` in preference to `.pnpmfile.cjs`, and neither once a `pnpmfile` setting
// names another file — so writing ours beside either would silently drop the project's hooks, or
// report a hook pnpm never runs.
const LEGACY_HOOK_FILE = '.pnpmfile.cjs'
const CONFIG_FILES: ReadonlyArray<string> = ['pnpm-workspace.yaml', '.npmrc']
const PNPMFILE_SETTINGS: ReadonlySet<string> = new Set(['pnpmfile', 'pnpmfiles'])
const SETTING_KEY_END = /[\s:=]/u
const manifest_schema = z.looseObject({ private: z.boolean().optional() })

type PackHookResult = 'written' | 'unchanged' | 'private' | 'owned' | 'withdrawn'

function is_published(manifest_text: string): boolean {
	return manifest_schema.parse(JSON.parse(manifest_text)).private !== true
}

function sets_pnpmfile(config_text: string): boolean {
	return config_text
		.split('\n')
		.some((line) => PNPMFILE_SETTINGS.has(line.trimStart().split(SETTING_KEY_END, 1)[0] ?? ''))
}

function has_own_hook_source(project_root: string): boolean {
	if (existsSync(path.join(project_root, LEGACY_HOOK_FILE))) return true

	return CONFIG_FILES.some((name) =>
		sets_pnpmfile(file_reader.read_file_or_empty(path.join(project_root, name))),
	)
}

function write_hook(destination: string, package_directory: string): PackHookResult {
	const source = readFileSync(path.join(package_directory, PACK_HOOK_FILE), 'utf8')

	return file_content.write_text_if_changed(destination, source) ? 'written' : 'unchanged'
}

// A copy kit wrote before the project added its own pnpmfile would still shadow that one.
function withdraw(destination: string, existing: string | undefined): PackHookResult {
	if (existing === undefined) return 'owned'
	rmSync(destination)

	return 'withdrawn'
}

// A pnpmfile without the managed line is the project's own; overwriting it would drop its hooks.
function apply(project_root: string, package_directory: string): PackHookResult {
	const destination = path.join(project_root, PACK_HOOK_FILE)
	const existing = file_reader.read_optional(destination)
	if (existing !== undefined && !existing.startsWith(MANAGED_LINE)) return 'owned'
	if (has_own_hook_source(project_root)) return withdraw(destination, existing)

	return write_hook(destination, package_directory)
}

const MESSAGES: Readonly<Record<PackHookResult, string | undefined>> = {
	written: `  ✔ synced    ${PACK_HOOK_FILE} (run \`pnpm install\` to refresh pnpmfileChecksum)`,
	unchanged: `  ✔ unchanged ${PACK_HOOK_FILE}`,
	private: undefined,
	owned: `  ⚠ skipped   ${PACK_HOOK_FILE} — the project has its own pnpmfile; strip the safe-chain preinstall at pack time there`,
	withdrawn: `  ⚠ removed   ${PACK_HOOK_FILE} — it shadowed the project's own pnpmfile; strip the safe-chain preinstall at pack time there`,
}

function sync_pack_hook(project_root: string, package_directory: string): PackHookResult {
	const manifest_text = file_reader.read_optional(path.join(project_root, MANIFEST_FILE))
	const is_private = manifest_text === undefined || !is_published(manifest_text)
	const result = is_private ? 'private' : apply(project_root, package_directory)
	const message = MESSAGES[result]
	if (message !== undefined) console.info(message)

	return result
}

const pack_hook = { MANAGED_LINE, sync_pack_hook }

export { pack_hook, PACK_HOOK_FILE }
export type { PackHookResult }
