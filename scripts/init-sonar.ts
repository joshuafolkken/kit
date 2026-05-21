import { existsSync } from 'node:fs'
import path from 'node:path'
import { gh_spawn } from './gh-spawn'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'
import { sonar_file } from './sonar-file'

function copy_sonar_with_template(): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	const destination_path = path.join(PROJECT_ROOT, destination)
	const is_existing = existsSync(destination_path)
	const identifiers = init_logic.derive_sonar_identifiers(name_with_owner)

	sonar_file.merge_sonar_file(
		path.join(PACKAGE_DIR, init_logic.get_sonar_template_source()),
		destination_path,
		identifiers,
	)
	console.info(`  ✔ ${is_existing ? 'updated' : 'created'}   ${destination}`)
}

const init_sonar = {
	copy_sonar_with_template,
}

export { init_sonar }
