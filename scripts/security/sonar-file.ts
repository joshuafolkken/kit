import { existsSync, readFileSync } from 'node:fs'
import { init_logic } from '#scripts/init/init-logic'
import type { SonarIdentifiers } from '#scripts/init/init-logic-sonar'
import { file_content } from '#scripts/sync/file-content'

// Written through `write_contained` like every other sync write, so a `sonar-project.properties`
// linked outside the project is refused rather than written through (joshuafolkken/kit#4634).

function write_sonar_file(
	template_source: string,
	destination_path: string,
	identifiers: SonarIdentifiers,
): void {
	const content = init_logic.apply_sonar_template(
		readFileSync(template_source, 'utf8'),
		identifiers.project_key,
		identifiers.organization,
	)

	file_content.write_contained(destination_path, content)
}

function merge_sonar_file(
	template_source: string,
	destination_path: string,
	identifiers: SonarIdentifiers,
): void {
	if (!existsSync(destination_path)) {
		write_sonar_file(template_source, destination_path, identifiers)

		return
	}

	const template_content = init_logic.apply_sonar_template(
		readFileSync(template_source, 'utf8'),
		identifiers.project_key,
		identifiers.organization,
	)
	const existing = readFileSync(destination_path, 'utf8')

	file_content.write_contained(
		destination_path,
		init_logic.merge_sonar_properties(existing, template_content),
	)
}

const sonar_file = { write_sonar_file, merge_sonar_file }

export { sonar_file }
