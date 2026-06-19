import { z } from 'zod'

// Capture the full version (including any prerelease identifier) up to the
// optional `+<hash>` suffix, so prerelease pins like `pnpm@11.6.0-rc.1+...` are
// read faithfully rather than truncated to `11.6.0`.
const PNPM_VERSION_REGEX = /^pnpm@([^+]+)/u

// Surgical replacements that touch only the `devEngines.packageManager.version`
// value, preserving the rest of the file's formatting byte-for-byte. Two key
// orders are supported because a hand-edited consumer manifest may list either
// `name` or `version` first.
const DEV_ENGINES_NAME_FIRST_REGEX = /("name":\s*"pnpm"\s*,\s*"version":\s*")[^"]+(")/u
const DEV_ENGINES_VERSION_FIRST_REGEX = /("version":\s*")[^"]+("\s*,\s*"name":\s*"pnpm")/u

const optional_version_schema = z.object({ version: z.string().optional() }).optional()

const alignment_read_schema = z.object({
	packageManager: z.string().optional(),
	devEngines: z
		.object({
			packageManager: optional_version_schema,
		})
		.optional(),
})

type AlignmentManifest = z.infer<typeof alignment_read_schema>

function extract_pnpm_version(package_manager: string): string | undefined {
	return PNPM_VERSION_REGEX.exec(package_manager)?.[1]
}

function read_current_version(parsed: AlignmentManifest): string | undefined {
	return parsed.devEngines?.packageManager?.version
}

// Return the version that `devEngines.packageManager.version` should adopt, or
// undefined when there is nothing to align: no `packageManager`, no existing
// `devEngines.packageManager`, or the two already match.
function resolve_alignment_target(parsed: AlignmentManifest): string | undefined {
	if (parsed.packageManager === undefined) return undefined
	const target = extract_pnpm_version(parsed.packageManager)
	const current = read_current_version(parsed)
	if (current === undefined || current === target) return undefined

	return target
}

// Surgically set `devEngines.packageManager.version` to `target`, preserving the
// rest of the file byte-for-byte. Returns the content unchanged when there is no
// `devEngines.packageManager` block to update.
// Replacer used with `String#replace` so the captured prefix/suffix are re-emitted
// around `target` literally — a `$` inside `target` is never read as a replacement
// pattern.
function set_development_engines_version(content: string, target: string): string {
	if (DEV_ENGINES_NAME_FIRST_REGEX.test(content)) {
		return content.replace(
			DEV_ENGINES_NAME_FIRST_REGEX,
			(_match: string, prefix: string, suffix: string) => `${prefix}${target}${suffix}`,
		)
	}

	if (DEV_ENGINES_VERSION_FIRST_REGEX.test(content)) {
		return content.replace(
			DEV_ENGINES_VERSION_FIRST_REGEX,
			(_match: string, prefix: string, suffix: string) => `${prefix}${target}${suffix}`,
		)
	}

	return content
}

// Align `devEngines.packageManager.version` with the version pinned in the
// `packageManager` field so pnpm 11.5.0+ (pnpm/pnpm#11307) suppresses the
// "Cannot use both ..." warning.
function align_development_engines_version(content: string): string {
	const parsed = alignment_read_schema.parse(JSON.parse(content))
	const target = resolve_alignment_target(parsed)
	if (target === undefined) return content

	return set_development_engines_version(content, target)
}

const package_manager_version = {
	extract_pnpm_version,
	align_development_engines_version,
	set_development_engines_version,
}

export { package_manager_version }
