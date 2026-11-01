import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const FAILED_SHOT_STATUS = 3

// A `shot` script that records the routes it was handed, standing in for a real capture: the CLI is
// judged on running the resolved command with the routes and passing its status through.
const RECORDING_SCRIPT = `node -e "require('fs').writeFileSync('${CAPTURE_FILE}', process.argv.slice(1).join(' '))"`

const scratch = mkdtempSync(path.join(tmpdir(), 'ui-shot-cli-test-'))

function project_with(scripts: Record<string, string>): string {
	const directory = mkdtempSync(path.join(scratch, 'project-'))

	writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture', scripts }))

	return directory
}

// A `josh-app` shim that answers the bare probe with a usage line listing `shot`, and a `shot` call
// by recording its arguments — the toolkit path end to end, probe included.
const TOOLKIT_SHIM = [
	'#!/bin/sh',
	'if [ "$#" -eq 0 ]; then echo "Usage: josh-app <check|shot>"; exit 1; fi',
	`echo "$*" > ${CAPTURE_FILE}`,
].join('\n')

function install_toolkit(directory: string): void {
	const bin_directory = path.join(directory, 'node_modules', '.bin')

	mkdirSync(bin_directory, { recursive: true })
	writeFileSync(path.join(bin_directory, 'josh-app'), TOOLKIT_SHIM, { mode: 0o755 })
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
})

describe('ui_shot_cli.run — a toolkit', () => {
	it(
		'runs a toolkit whose usage line lists shot ahead of the shot script',
		async () => {
			const directory = project_with({ shot: 'exit 9' })

			install_toolkit(directory)

			expect(await ui_shot_cli.run(ROUTES, directory)).toBe(0)
			expect(readFileSync(path.join(directory, CAPTURE_FILE), 'utf8')).toBe('shot / /blog\n')
		},
		CAPTURE_TIMEOUT_MS,
	)
})

describe('ui_shot_cli.run — where the script is found and what it answers', () => {
	it(
		'finds the shot script of the enclosing package from a subdirectory',
		async () => {
			const directory = project_with({ shot: RECORDING_SCRIPT })
			const nested = path.join(directory, 'src')

			mkdirSync(nested)

			expect(await ui_shot_cli.run(ROUTES, nested)).toBe(0)
			expect(readFileSync(path.join(directory, CAPTURE_FILE), 'utf8')).toBe('/ /blog')
		},
		CAPTURE_TIMEOUT_MS,
	)

	it(
		"answers with the shot command's own non-zero exit status",
		async () => {
			const directory = project_with({
				shot: `node -e "process.exit(${String(FAILED_SHOT_STATUS)})"`,
			})

			expect(await ui_shot_cli.run(ROUTES, directory)).toBe(FAILED_SHOT_STATUS)
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

describe('ui_shot_cli.main', () => {
	it('sets the process exit code to the run result', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		try {
			await ui_shot_cli.main([], project_with({}))

			expect(process.exitCode).toBe(1)
		} finally {
			process.exitCode = undefined
		}
	})
})
