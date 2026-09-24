const SONAR_PROJECT_KEY_PLACEHOLDER = '{{PROJECT_KEY}}'
const SONAR_ORGANIZATION_PLACEHOLDER = '{{ORGANIZATION}}'
const SONAR_TEMPLATE_SRC = 'templates/sonar-project.properties'
const SONAR_TEMPLATE_DEST = 'sonar-project.properties'
const PROPERTY_LINE_PATTERN = /^([\w.]+)=/u
const MULTICRITERIA_KEY = 'sonar.issue.ignore.multicriteria'
const MULTICRITERIA_LINE_PATTERN = /^sonar\.issue\.ignore\.multicriteria=(.*)$/mu

interface SonarIdentifiers {
	project_key: string
	organization: string
}

function apply_sonar_template(content: string, project_key: string, organization: string): string {
	return content
		.replaceAll(SONAR_PROJECT_KEY_PLACEHOLDER, () => project_key)
		.replaceAll(SONAR_ORGANIZATION_PLACEHOLDER, () => organization)
}

function derive_sonar_identifiers(name_with_owner: string): SonarIdentifiers {
	const [organization, repository, ...extra] = name_with_owner.trim().split('/')

	if (!organization || !repository || extra.length > 0) {
		throw new Error(`Invalid GitHub repository nameWithOwner: ${name_with_owner}`)
	}

	return {
		organization,
		project_key: `${organization}_${repository}`,
	}
}

function get_sonar_template_source(): string {
	return SONAR_TEMPLATE_SRC
}

function get_sonar_template_destination(): string {
	return SONAR_TEMPLATE_DEST
}

function extract_properties_keys(content: string): Set<string> {
	const keys = new Set<string>()

	for (const line of content.split('\n')) {
		const match = PROPERTY_LINE_PATTERN.exec(line)
		if (match?.[1] !== undefined) keys.add(match[1])
	}

	return keys
}

function get_multicriteria_value(content: string): string | undefined {
	return MULTICRITERIA_LINE_PATTERN.exec(content)?.[1]
}

function get_multicriteria_ids(content: string): Array<string> {
	return (get_multicriteria_value(content) ?? '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean)
}

function get_property_value(content: string, key: string): string | undefined {
	return content
		.split('\n')
		.find((line) => line.startsWith(`${key}=`))
		?.slice(key.length + 1)
}

function has_criterion_conflict(existing: string, template: string, id: string): boolean {
	return ['ruleKey', 'resourceKey'].some((field) => {
		const key = `${MULTICRITERIA_KEY}.${id}.${field}`
		const existing_value = get_property_value(existing, key)
		const template_value = get_property_value(template, key)

		return (
			existing_value !== undefined &&
			template_value !== undefined &&
			existing_value !== template_value
		)
	})
}

function criterion_matches(
	existing: string,
	template: string,
	existing_id: string,
	template_id: string,
): boolean {
	const template_prefix = `${MULTICRITERIA_KEY}.${template_id}`
	const existing_prefix = `${MULTICRITERIA_KEY}.${existing_id}`
	const rule = get_property_value(template, `${template_prefix}.ruleKey`)
	const resource = get_property_value(template, `${template_prefix}.resourceKey`)
	if (rule === undefined || resource === undefined) return false

	return (
		rule === get_property_value(existing, `${existing_prefix}.ruleKey`) &&
		resource === get_property_value(existing, `${existing_prefix}.resourceKey`)
	)
}

function allocate_criterion_id(used_ids: Set<string>): string {
	let next_index = 1

	for (const id of used_ids) {
		const numeric_id = /^e(\d+)$/u.exec(id)?.[1]
		if (numeric_id !== undefined) next_index = Math.max(next_index, Number(numeric_id) + 1)
	}

	return `e${next_index.toString()}`
}

function rename_criterion(template: string, id: string, replacement_id: string): string {
	const ids = get_multicriteria_ids(template).map((entry) =>
		entry === id ? replacement_id : entry,
	)
	const updated_list = template.replace(
		MULTICRITERIA_LINE_PATTERN,
		() => `${MULTICRITERIA_KEY}=${ids.join(',')}`,
	)

	return updated_list.replaceAll(
		`${MULTICRITERIA_KEY}.${id}.`,
		() => `${MULTICRITERIA_KEY}.${replacement_id}.`,
	)
}

function find_matching_criterion(
	existing: string,
	template: string,
	ids: Array<string>,
	id: string,
): string | undefined {
	return ids.find((candidate) => criterion_matches(existing, template, candidate, id))
}

function resolve_multicriteria_conflicts(existing: string, template: string): string {
	const existing_ids = get_multicriteria_ids(existing)
	const template_ids = get_multicriteria_ids(template)
	const reusable_ids = existing_ids.filter((id) => !template_ids.includes(id))
	let resolved = template

	for (const id of template_ids) {
		if (!existing_ids.includes(id) || !has_criterion_conflict(existing, resolved, id)) continue
		const matching_id = find_matching_criterion(existing, resolved, reusable_ids, id)
		const replacement_id =
			matching_id ??
			allocate_criterion_id(new Set([...existing_ids, ...get_multicriteria_ids(resolved)]))

		resolved = rename_criterion(resolved, id, replacement_id)
	}

	return resolved
}

function merge_multicriteria_ids(existing: string, template_content: string): string {
	const existing_value = get_multicriteria_value(existing)
	if (existing_value === undefined) return existing
	const template_value = get_multicriteria_value(template_content)
	if (template_value === undefined) return existing

	const existing_ids = get_multicriteria_ids(existing)
	const template_ids = get_multicriteria_ids(template_content)
	const merged_ids = [...new Set([...existing_ids, ...template_ids])]
	if (merged_ids.join(',') === existing_value) return existing

	return existing.replace(
		MULTICRITERIA_LINE_PATTERN,
		() => `${MULTICRITERIA_KEY}=${merged_ids.join(',')}`,
	)
}

function merge_sonar_properties(existing: string, template_content: string): string {
	const resolved_template = resolve_multicriteria_conflicts(existing, template_content)
	const merged_existing = merge_multicriteria_ids(existing, resolved_template)
	const existing_keys = extract_properties_keys(merged_existing)
	const lines_to_add = resolved_template.split('\n').filter((line) => {
		const key = PROPERTY_LINE_PATTERN.exec(line)?.[1]

		return key !== undefined && !existing_keys.has(key)
	})
	if (lines_to_add.length === 0) return merged_existing
	const normalized = merged_existing.endsWith('\n') ? merged_existing : `${merged_existing}\n`

	return `${normalized}\n${lines_to_add.join('\n')}\n`
}

const init_logic_sonar = {
	apply_sonar_template,
	derive_sonar_identifiers,
	get_sonar_template_source,
	get_sonar_template_destination,
	merge_sonar_properties,
}

export { init_logic_sonar }
export type { SonarIdentifiers }
