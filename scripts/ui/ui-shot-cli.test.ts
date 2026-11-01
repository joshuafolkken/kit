import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { ui_shot_cli } from './ui-shot-cli'

const COMMAND = 'ui:shot'
const SCRIPT_PATH = 'scripts/ui/ui-shot-cli.ts'
const ROUTES: ReadonlyArray<string> = ['/', '/blog']
const CAPTURE_FILE = 'captured.txt'
const CAPTURE_TIMEOUT_MS = 60_000

// A `shot` script that records the routes it was handed, standing in for a real capture: the CLI is
// judged on running the resolved command with the routes and passing its status through.
const RECORDING_SCRIPT = `node -e "require('fs').writeFileSync('${CAPTURE_FILE}', process.argv.slice(1).join(' '))"`

const scratch = mkdtempSync(path.join(tmpdir(), 'ui-shot-cli-test-'))

function project_with(scripts: Record<string, string>): string {
	const directory = mkdtempSync(path.join(scratch, 'project-'))

	writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', scripts }))

	return directory
}

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('josh ui:shot — registration', () => {
	it('is registered against its CLI script', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})
})

describe('ui_shot_cli.run', () => {
	it('refuses an invocation with no route', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await ui_shot_cli.run([], project_with({}))).toBe(1)
		expect(error).toHaveBeenCalledWith(ui_shot_cli.USAGE)
	})

	it(
		"runs the project's shot script with the routes",
		async () => {
			const directory = project_with({ shot: RECORDING_SCRIPT })

			expect(await ui_shot_cli.run(ROUTES, directory)).toBe(0)
			expect(readFileSync(path.join(directory, CAPTURE_FILE), 'utf8')).toBe('/ /blog')
		},
		CAPTURE_TIMEOUT_MS,
	)

	it('fails with the candidate list in a project without a screenshot command', async () => {
		const directory = project_with({ test: RECORDING_SCRIPT })
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await ui_shot_cli.run(ROUTES, directory)).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('pnpm josh-app shot'))
		expect(existsSync(path.join(directory, CAPTURE_FILE))).toBe(false)
	})
})
