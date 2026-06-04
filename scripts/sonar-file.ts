import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from './init/init-logic'
import type { SonarIdentifiers } from './init/init-logic-sonar'

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

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, content)
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

	writeFileSync(destination_path, init_logic.merge_sonar_properties(existing, template_content))
}

const sonar_file = { write_sonar_file, merge_sonar_file }

export { sonar_file }
