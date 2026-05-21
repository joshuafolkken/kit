const COMPATIBILITY_DATE_PATTERN = /"compatibility_date"\s*:\s*"([^"]*)"/u

function extract_compatibility_date(content: string): string | undefined {
	return COMPATIBILITY_DATE_PATTERN.exec(content)?.[1]
}

function update_compatibility_date(existing: string, new_date: string): string {
	return existing.replace(COMPATIBILITY_DATE_PATTERN, `"compatibility_date": "${new_date}"`)
}

function merge_wrangler_jsonc(existing: string, template: string): string {
	const new_date = extract_compatibility_date(template)
	if (new_date === undefined) return existing

	return update_compatibility_date(existing, new_date)
}

const init_logic_wrangler = { extract_compatibility_date, merge_wrangler_jsonc }

export { init_logic_wrangler }
