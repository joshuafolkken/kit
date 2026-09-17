import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { package_version_schema } from '#scripts/lib/schemas'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { safe_json_parse } from '#scripts/version/parse-json'
import semver from 'semver'

// `josh sync` writes the consumer's `.claude/settings.json`, whose hooks now invoke the bundle at
// `node_modules/@joshuafolkken/kit/dist/josh.js` (joshuafolkken/kit#1930). When sync is run from a
// newer source than the consumer's installed package — an `npx @joshuafolkken/kit sync`, or a global
// josh — the settings it writes reference commands (e.g. `pretool:guard`) the older installed bundle
// does not have, and every prompt then fails a hook that exits `Unknown command`
// (joshuafolkken/kit#1930's own observation, kit 1.214). This checks the version before writing and
// asks the consumer to update first rather than leaving broken hooks behind.
//
// Run through `pnpm josh sync` in the consumer the two versions are equal by construction — the same
// install both writes the file and runs the hooks — so this never blocks the ordinary path.

const NODE_MODULES = 'node_modules'

function read_version_at(package_json_path: string): string | undefined {
	if (!existsSync(package_json_path)) return undefined
	const parsed = package_version_schema.safeParse(
		safe_json_parse(readFileSync(package_json_path, 'utf8')),
	)

	return parsed.success ? parsed.data.version : undefined
}

// The version of kit installed in the consumer's node_modules — the bundle the rewritten hooks
// actually run. Undefined before the first install, which is safe: a fresh install receives the
// matching bundle, so there is nothing older to break.
function installed_consumer_version(project_root: string): string | undefined {
	return read_version_at(path.join(project_root, NODE_MODULES, KIT_PACKAGE_NAME, 'package.json'))
}

// Unsafe only when both versions are known AND the installed bundle the hooks run is older than the
// version writing the settings. Either version unknown → safe: nothing can be asserted about a
// mismatch, and refusing to write on a missing read would break a legitimate fresh sync.
function is_safe_to_write_hooks(
	writing_version: string | undefined,
	installed_version: string | undefined,
): boolean {
	if (writing_version === undefined || installed_version === undefined) return true

	return !semver.lt(installed_version, writing_version)
}

function outdated_install_warning(writing_version: string, installed_version: string): string {
	return (
		`  ⚠ skipped   .claude/settings.json — installed ${KIT_PACKAGE_NAME} is ${installed_version}, ` +
		`older than the ${writing_version} writing it. Its hooks would call commands this install ` +
		`cannot run. Run \`pnpm update ${KIT_PACKAGE_NAME}\` first, then \`pnpm josh sync\` again.`
	)
}

// The one line to print and the reason to skip the hook file, or undefined when it is safe to write.
function hook_write_warning(
	project_root: string,
	writing_version: string | undefined,
): string | undefined {
	const installed_version = installed_consumer_version(project_root)
	if (writing_version === undefined || installed_version === undefined) return undefined
	if (is_safe_to_write_hooks(writing_version, installed_version)) return undefined

	return outdated_install_warning(writing_version, installed_version)
}

const sync_hook_safety = {
	hook_write_warning,
	installed_consumer_version,
	is_safe_to_write_hooks,
	outdated_install_warning,
	read_version_at,
}

export { sync_hook_safety }
