import path from 'node:path'

const PACKAGE_NAME = '@joshuafolkken/kit'
const PACKAGE_JSON = 'package.json'
const UPDATE_COMMAND_PREFIX = 'pnpm add -D'

function resolve_package_path(
	cwd: string,
	self_directory: string,
	exists: (candidate: string) => boolean,
): string {
	const consumer_path = path.join(cwd, 'node_modules', PACKAGE_NAME, PACKAGE_JSON)
	if (exists(consumer_path)) return consumer_path

	return path.join(self_directory, '..', PACKAGE_JSON)
}

function format_version_status(current: string, latest: string): string {
	if (current === latest) return '✓ Up to date'

	return `⚠ Update available: ${current} → ${latest}`
}

function format_update_command(latest: string): string {
	return `${UPDATE_COMMAND_PREFIX} ${PACKAGE_NAME}@${latest}`
}

function format_version_output(current: string, latest: string): string {
	const lines = [
		`Current: ${current}`,
		`Latest:  ${latest}`,
		format_version_status(current, latest),
	]

	if (current !== latest) {
		lines.push('', `Run: ${format_update_command(latest)}`)
	}

	return lines.join('\n')
}

const version_check_logic = {
	PACKAGE_NAME,
	resolve_package_path,
	format_version_output,
	format_update_command,
}

export { version_check_logic }
