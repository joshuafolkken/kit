const SONAR_PROJECT_KEY_PLACEHOLDER = '{{PROJECT_KEY}}'
const SONAR_ORGANIZATION_PLACEHOLDER = '{{ORGANIZATION}}'
const SONAR_TEMPLATE_SRC = 'templates/sonar-project.properties'
const SONAR_TEMPLATE_DEST = 'sonar-project.properties'

interface SonarIdentifiers {
	project_key: string
	organization: string
}

function apply_sonar_template(content: string, project_key: string, organization: string): string {
	return content
		.replaceAll(SONAR_PROJECT_KEY_PLACEHOLDER, project_key)
		.replaceAll(SONAR_ORGANIZATION_PLACEHOLDER, organization)
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

const init_logic_sonar = {
	apply_sonar_template,
	derive_sonar_identifiers,
	get_sonar_template_source,
	get_sonar_template_destination,
}

export { init_logic_sonar }
export type { SonarIdentifiers }
