import { existsSync } from 'node:fs'
import path from 'node:path'
import { gh_spawn } from './gh-spawn'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'
import { sonar_file } from './sonar-file'

function copy_sonar_if_missing(
	destination: string,
	identifiers: ReturnType<typeof init_logic.derive_sonar_identifiers>,
): void {
	const destination_path = path.join(PROJECT_ROOT, destination)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${destination} (already exists — run josh sync to update)`)

		return
	}

	const template_source = path.join(PACKAGE_DIR, init_logic.get_sonar_template_source())

	sonar_file.write_sonar_file(template_source, destination_path, identifiers)
	console.info(`  ✔ created   ${destination}`)
}

function copy_sonar_with_template(): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	copy_sonar_if_missing(destination, init_logic.derive_sonar_identifiers(name_with_owner))
}

const init_sonar = {
	copy_sonar_with_template,
}

export { init_sonar }
