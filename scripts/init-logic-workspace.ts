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

function merge_workspace_yaml(existing: string, template: string): string {
	if (!existing.trim()) return template
	const normalized = existing.endsWith('\n') ? existing : `${existing}\n`
	const template_keys = new Set(extract_yaml_top_level_keys(template))
	const user_keys = extract_yaml_top_level_keys(normalized).filter((k) => !template_keys.has(k))
	if (user_keys.length === 0) return template

	return append_user_blocks(template, user_keys, normalized)
}

const init_logic_workspace = { merge_workspace_yaml }

export { init_logic_workspace }
