import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from './init-logic'
import type { SonarIdentifiers } from './init-logic-sonar'

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

const sonar_file = { write_sonar_file }

export { sonar_file }
