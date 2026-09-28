import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { environment_file_fixture } from './environment-file-fixture'
import { web_server } from './web-server.js'

const TEMP_DIRECTORY_PREFIX = 'kit-web-server-'
const PACKAGE_FILE_NAME = 'package.json'
const DEV_COMMAND = 'node --run dev'
const DEV_SCRIPT = 'vite dev'
const BUILD_SCRIPT = 'vite build'

const PROJECT_DIRECTORY = environment_file_fixture.make_project_directory(TEMP_DIRECTORY_PREFIX)

function write_scripts(scripts: Record<string, string>): void {
	writeFileSync(path.join(PROJECT_DIRECTORY, PACKAGE_FILE_NAME), JSON.stringify({ scripts }))
}

afterAll(() => {
	environment_file_fixture.remove_project_directory(PROJECT_DIRECTORY)
})

describe('web_server.script_command', () => {
	it('runs a script through node --run rather than a package manager', () => {
		write_scripts({ dev: DEV_SCRIPT })

		expect(web_server.script_command(['dev'], PROJECT_DIRECTORY)).toBe(DEV_COMMAND)
	})

	it('chains several scripts in the order given', () => {
		write_scripts({ build: BUILD_SCRIPT, preview: 'vite preview' })

		expect(web_server.script_command(['build', 'preview'], PROJECT_DIRECTORY)).toBe(
			'node --run build && node --run preview',
		)
	})

	// node --run skips pre hooks, which pnpm run executed — a consumer's `prepreview` migration
	// would otherwise vanish silently from its CI webServer.
	it('runs a pre hook before its script when the project defines one', () => {
		write_scripts({ build: BUILD_SCRIPT, prepreview: 'migrate', preview: 'wrangler dev' })

		expect(web_server.script_command(['build', 'preview'], PROJECT_DIRECTORY)).toBe(
			'node --run build && node --run prepreview && node --run preview',
		)
	})

	it('does not add a post hook, which a long-running server never reaches', () => {
		write_scripts({ dev: DEV_SCRIPT, postdev: 'cleanup' })

		expect(web_server.script_command(['dev'], PROJECT_DIRECTORY)).toBe(DEV_COMMAND)
	})

	it('reads the project root package.json from a subdirectory, as node --run does', () => {
		write_scripts({ predev: 'prepare', dev: DEV_SCRIPT })
		const nested = environment_file_fixture.make_subdirectory(PROJECT_DIRECTORY, 'nested')

		expect(web_server.script_command(['dev'], nested)).toBe('node --run predev && node --run dev')
	})

	it('treats a package.json without scripts as having no hooks', () => {
		writeFileSync(path.join(PROJECT_DIRECTORY, PACKAGE_FILE_NAME), '{}\n')

		expect(web_server.script_command(['dev'], PROJECT_DIRECTORY)).toBe(DEV_COMMAND)
	})
})
