import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'

function get_repo_name_with_owner(): string | undefined {
	/* eslint-disable sonarjs/no-os-command-from-path */
	const result = spawnSync(
		'gh',
		['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
		{ encoding: 'utf8', cwd: PROJECT_ROOT },
	)
	/* eslint-enable sonarjs/no-os-command-from-path */
	if (result.status !== 0 || !result.stdout) return undefined

	return result.stdout.trim() || undefined
}

function copy_sonar_file_write(
	template_source: string,
	destination_path: string,
	project_key: string,
	organization: string,
): void {
	const content = init_logic.apply_sonar_template(
		readFileSync(template_source, 'utf8'),
		project_key,
		organization,
	)

	writeFileSync(destination_path, content)
}

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

	copy_sonar_file_write(
		template_source,
		destination_path,
		identifiers.project_key,
		identifiers.organization,
	)
	console.info(`  ✔ created   ${destination}`)
}

function copy_sonar_with_template(): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	copy_sonar_if_missing(destination, init_logic.derive_sonar_identifiers(name_with_owner))
}

const init_sonar = {
	copy_sonar_file_write,
	copy_sonar_with_template,
}

export { init_sonar }
