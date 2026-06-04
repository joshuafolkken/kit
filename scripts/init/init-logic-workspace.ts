function extract_yaml_top_level_keys(content: string): Array<string> {
	return content.split('\n').flatMap((line) => {
		const key = /^([a-zA-Z][a-zA-Z0-9_-]*):/u.exec(line)?.[1]

		return key ? [key] : []
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

function merge_workspace_yaml(existing: string, template: string): string {
	if (!existing.trim()) return template
	const normalized = existing.endsWith('\n') ? existing : `${existing}\n`
	const without_deprecated = remove_deprecated_yaml_keys(normalized)
	if (!without_deprecated.trim()) return template
	const existing_keys = new Set(extract_yaml_top_level_keys(without_deprecated))
	const new_keys = extract_yaml_top_level_keys(template).filter((k) => !existing_keys.has(k))
	if (new_keys.length === 0) return without_deprecated

	return append_user_blocks(without_deprecated, new_keys, template)
}

const init_logic_workspace = { merge_workspace_yaml }

export { init_logic_workspace }
