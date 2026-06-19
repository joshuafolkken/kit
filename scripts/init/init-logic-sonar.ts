const SONAR_PROJECT_KEY_PLACEHOLDER = '{{PROJECT_KEY}}'
const SONAR_ORGANIZATION_PLACEHOLDER = '{{ORGANIZATION}}'
const SONAR_TEMPLATE_SRC = 'templates/sonar-project.properties'
const SONAR_TEMPLATE_DEST = 'sonar-project.properties'
const PROPERTY_LINE_PATTERN = /^([\w.]+)=/u

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

function merge_sonar_properties(existing: string, template_content: string): string {
	const existing_keys = extract_properties_keys(existing)
	const lines_to_add = template_content.split('\n').filter((line) => {
		const key = PROPERTY_LINE_PATTERN.exec(line)?.[1]

		return key !== undefined && !existing_keys.has(key)
	})
	if (lines_to_add.length === 0) return existing
	const normalized = existing.endsWith('\n') ? existing : `${existing}\n`

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
