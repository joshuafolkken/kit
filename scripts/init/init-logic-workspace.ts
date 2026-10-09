function extract_yaml_top_level_keys(content: string): Array<string> {
	return content.split('\n').flatMap((line) => {
		const key = /^([a-zA-Z][a-zA-Z0-9_-]*):/u.exec(line)?.[1]

		return key ?? []
	})
}

function extract_yaml_block(content: string, key: string): string {
	const pattern = new RegExp(String.raw`(^${key}:[^\n]*\n(?:(?:[ \t][^\n]*|)\n)*)`, 'mu')

	return pattern.exec(content)?.[1]?.trimEnd() ?? ''
}

function append_user_blocks(base: string, user_keys: Array<string>, existing: string): string {
	const user_blocks = user_keys
		.map((k) => extract_yaml_block(existing, k))
		.filter(Boolean)
		.join('\n')
	const normalized = base.endsWith('\n') ? base : `${base}\n`

	return `${normalized}\n${user_blocks}\n`
}

const DEPRECATED_KEYS = new Set(['onlyBuiltDependencies'])

function remove_deprecated_yaml_key(content: string, key: string): string {
	const block = extract_yaml_block(content, key)
	if (block.length === 0) return content
	const removed = content.replaceAll(`${block}\n`, '')

	return removed.replaceAll(/\n{3,}/gu, '\n\n')
}

function remove_deprecated_yaml_keys(content: string): string {
	let result = content

	for (const key of DEPRECATED_KEYS) {
		result = remove_deprecated_yaml_key(result, key)
	}

	return `${result.trimEnd()}\n`
}

// pnpm 11+ writes this placeholder into `allowBuilds` for every build script it ignored, and fails
// every later install until it is answered. `pnpm add -D @joshuafolkken/kit` before `josh init`
// leaves one for esbuild, and the key-level merge below keeps an existing `allowBuilds` whole, so a
// placeholder the template decides is answered here.
const BUILD_PLACEHOLDER_PATTERN = /^([ \t]+)([^\s:#][^:#]*): set this to true or false$/gmu
const TEMPLATE_BUILD_PATTERN = /^[ \t]+(?<key>[^\s:#][^:#]*):[ \t]*(?<value>true|false)\b/u

function unquote(key: string): string {
	return key.trim().replaceAll(/^['"]|['"]$/gu, '')
}

function template_build_values(template: string): Map<string, string> {
	const lines = extract_yaml_block(template, 'allowBuilds').split('\n')

	return new Map(
		lines.flatMap((line) => {
			const { key, value } = TEMPLATE_BUILD_PATTERN.exec(line)?.groups ?? {}

			return key && value ? [[unquote(key), value] as const] : []
		}),
	)
}

function answer_build_placeholders(existing: string, template: string): string {
	const values = template_build_values(template)

	return existing.replaceAll(BUILD_PLACEHOLDER_PATTERN, (line, indent: string, key: string) => {
		const value = values.get(unquote(key))

		return value === undefined ? line : `${indent}${key}: ${value}`
	})
}

const BUILD_ENTRY_KEY_PATTERN = /^[ \t]+(?<key>[^\s:#][^:#]*):/u

function build_entry_key(line: string): string | undefined {
	const key = BUILD_ENTRY_KEY_PATTERN.exec(line)?.groups?.['key']

	return key === undefined ? undefined : unquote(key)
}

function build_entry_keys(block: string): Set<string> {
	return new Set(block.split('\n').flatMap((line) => build_entry_key(line) ?? []))
}

// The key-level merge keeps an existing `allowBuilds` whole, and `pnpm add -D @joshuafolkken/kit`
// before `josh init` always leaves one (esbuild's), so without this the template's other approvals
// never landed and the first `pnpm install` failed on the next build script, e.g. unrs-resolver's.
// Entries the project already answered keep their value.
// Only a block mapping can take appended entry lines; a flow map (`allowBuilds: { … }`) is left whole.
const BLOCK_MAPPING_HEADER_PATTERN = /^allowBuilds:[ \t]*(?:#[^\n]*)?(?:\n|$)/u
const LEADING_INDENT_PATTERN = /^[ \t]+/u

// Appended lines take the indent of the block's own entries: a mapping whose items start at
// different columns is invalid YAML, so a four-space block must not gain two-space lines.
function block_entry_indent(block: string): string | undefined {
	const entry = block.split('\n').find((line) => build_entry_key(line) !== undefined)

	return entry === undefined ? undefined : LEADING_INDENT_PATTERN.exec(entry)?.[0]
}

function reindent(line: string, indent: string | undefined): string {
	return indent === undefined ? line : line.replace(LEADING_INDENT_PATTERN, () => indent)
}

function add_missing_build_entries(existing: string, template: string): string {
	const block = extract_yaml_block(existing, 'allowBuilds')
	if (!BLOCK_MAPPING_HEADER_PATTERN.test(block)) return existing
	const present = build_entry_keys(block)
	const indent = block_entry_indent(block)
	const missing = extract_yaml_block(template, 'allowBuilds')
		.split('\n')
		.filter((line) => {
			const key = build_entry_key(line)

			return key !== undefined && !present.has(key)
		})
		.map((line) => reindent(line, indent))
	if (missing.length === 0) return existing

	return existing.replace(block, () => [block, ...missing].join('\n'))
}

interface MovedNpmrcSetting {
	npmrc_key: string
	workspace_key: string
	value_pattern: RegExp
}

// `.npmrc` settings pnpm 12 reads only from `pnpm-workspace.yaml`, with the value shape each takes.
// A project's own value (a longer age window, `engine-strict=false`) replaces the template's, so the
// move neither loosens nor tightens what the project chose.
const MOVED_NPMRC_SETTINGS: ReadonlyArray<MovedNpmrcSetting> = [
	{ npmrc_key: 'minimum-release-age', workspace_key: 'minimumReleaseAge', value_pattern: /^\d+$/u },
	{ npmrc_key: 'engine-strict', workspace_key: 'engineStrict', value_pattern: /^(?:true|false)$/u },
]

// The last assignment wins, as it does when npm reads the file.
function npmrc_value(npmrc: string, key: string): string | undefined {
	const pattern = new RegExp(String.raw`^[ \t]*${key}[ \t]*=[ \t]*(\S+)[ \t]*$`, 'gmu')

	return [...npmrc.matchAll(pattern)].at(-1)?.[1]
}

function carry_npmrc_setting(template: string, npmrc: string, setting: MovedNpmrcSetting): string {
	const value = npmrc_value(npmrc, setting.npmrc_key)
	if (value === undefined || !setting.value_pattern.test(value)) return template
	const line_pattern = new RegExp(`^${setting.workspace_key}:.*$`, 'mu')

	return template.replace(line_pattern, () => `${setting.workspace_key}: ${value}`)
}

function carry_npmrc_settings(template: string, npmrc: string): string {
	let result = template

	for (const setting of MOVED_NPMRC_SETTINGS) {
		result = carry_npmrc_setting(result, npmrc, setting)
	}

	return result
}

function merge_workspace_yaml(existing: string, template: string): string {
	if (!existing.trim()) return template
	const normalized = existing.endsWith('\n') ? existing : `${existing}\n`
	const answered = answer_build_placeholders(remove_deprecated_yaml_keys(normalized), template)
	const cleaned = add_missing_build_entries(answered, template)
	if (!cleaned.trim()) return template
	const existing_keys = new Set(extract_yaml_top_level_keys(cleaned))
	const new_keys = extract_yaml_top_level_keys(template).filter((k) => !existing_keys.has(k))
	if (new_keys.length === 0) return cleaned

	return append_user_blocks(cleaned, new_keys, template)
}

const init_logic_workspace = { carry_npmrc_settings, merge_workspace_yaml, template_build_values }

export { init_logic_workspace }
