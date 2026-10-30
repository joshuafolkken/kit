import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { execa } from 'execa'
import { afterAll, describe, expect, it } from 'vitest'
import { edited_cspell, type CspellRequest } from './edited-cspell'

// joshuafolkken/kit#2296: the edit hook reports the edited file's cspell unknown words as
// additionalContext, and reports nothing when there are none — and never fails the edit, however the
// spell check behaves.

const DIRECTORY = mkdtempSync(path.join(tmpdir(), 'edited-cspell-'))
const TEXT = 'content'
// A real cspell start takes about a second, two of them more under a loaded machine.
const LIVE_TIMEOUT_MS = 60_000

function file_of(name: string): string {
	const target = path.join(DIRECTORY, name)

	writeFileSync(target, TEXT)

	return target
}

async function never_called(): Promise<string> {
	throw new Error('runner should not have been called')
}

afterAll(() => {
	rmSync(DIRECTORY, { recursive: true, force: true })
})

describe('format_unknown_words', () => {
	it('names each unknown word under a header', () => {
		const block = edited_cspell.format_unknown_words('widget\ngizmo\n')

		expect(block).toContain('widget')
		expect(block).toContain('gizmo')
		expect(block).toContain('cspell')
	})

	it('reports nothing when cspell knew every word', () => {
		expect(edited_cspell.format_unknown_words('')).toBeUndefined()
		expect(edited_cspell.format_unknown_words('   \n\n')).toBeUndefined()
	})
})

describe('spelling_diagnostics', () => {
	it('reports nothing for a missing path', async () => {
		const block = await edited_cspell.spelling_diagnostics(undefined, DIRECTORY, TEXT, never_called)

		expect(block).toBeUndefined()
	})

	it('does not spell-check a binary asset', async () => {
		const asset = file_of('logo.png')
		const block = await edited_cspell.spelling_diagnostics(asset, DIRECTORY, TEXT, never_called)

		expect(block).toBeUndefined()
	})

	it('returns the unknown words for a checkable file', async () => {
		const source = file_of('widget.ts')
		const block = await edited_cspell.spelling_diagnostics(
			source,
			DIRECTORY,
			TEXT,
			async () => 'widget\n',
		)

		expect(block).toContain('widget')
	})

	it('reports nothing when the runner finds no unknown words', async () => {
		const source = file_of('clean.ts')
		const block = await edited_cspell.spelling_diagnostics(source, DIRECTORY, TEXT, async () => '')

		expect(block).toBeUndefined()
	})

	// A `PostToolUse` hook must never turn a landed edit into a failure — cspell absent, a timeout — so
	// a throwing runner resolves to nothing rather than rejecting.
	it('never rejects when the spell check throws', async () => {
		const source = file_of('broken.ts')

		await expect(
			edited_cspell.spelling_diagnostics(source, DIRECTORY, TEXT, async () => {
				throw new Error('cspell exploded')
			}),
		).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#4596: the check runs beside the formatters, so it is handed the text the caller
// read rather than reading a file they may be rewriting.
describe('spelling_diagnostics — the text it checks', () => {
	it('hands the runner the text it was given, under the edited path', async () => {
		const source = file_of('handed.ts')
		const text = 'before format'
		const requests: Array<CspellRequest> = []

		await edited_cspell.spelling_diagnostics(source, DIRECTORY, text, async (request) => {
			requests.push(request)

			return ''
		})

		expect(requests).toStrictEqual([{ file_path: source, project_root: DIRECTORY, text }])
	})
})

// joshuafolkken/kit#4596: the live runner reads the text from stdin under the file's own name. A
// project of its own, with this checkout's `node_modules` linked in, pins that the project config —
// its word list and its ignore list — agrees between the stdin and file-path routes.
// The real path: macOS hands out a temporary directory under a symlink, and cspell's path route
// reads a file reached through one as outside its working directory.
const PROJECT = path.join(realpathSync(DIRECTORY), 'live')
// cspell:disable-next-line
const UNKNOWN_WORD = 'zzqqxyword'
// cspell:disable-next-line
const KNOWN_WORD = 'knownword'
const CONFIG = `version: "0.2"\nwords:\n  - ${KNOWN_WORD}\nignorePaths:\n  - ignored.md\n`
const BODY = `const ${UNKNOWN_WORD} = "${KNOWN_WORD}"\n`
const PATH_ROUTE_ARGS = ['lint', '--words-only', '--unique', '--no-progress', '--no-summary']

mkdirSync(PROJECT)
symlinkSync(path.resolve('node_modules'), path.join(PROJECT, 'node_modules'))
writeFileSync(path.join(PROJECT, 'cspell.config.yaml'), CONFIG)

async function path_route(file_path: string): Promise<string> {
	const result = await execa(
		resolve_local_bin(PROJECT, 'cspell'),
		[...PATH_ROUTE_ARGS, file_path],
		{
			reject: false,
			cwd: PROJECT,
			stderr: 'ignore',
		},
	)

	return result.stdout
}

async function both_routes(name: string): Promise<ReadonlyArray<string>> {
	const file_path = path.join(PROJECT, name)

	writeFileSync(file_path, BODY)

	return await Promise.all([
		edited_cspell.run_cspell({ file_path, project_root: PROJECT, text: BODY }),
		path_route(file_path),
	])
}

describe('cspell_command', () => {
	it('spawns the project shim directly when it is installed', () => {
		expect(edited_cspell.cspell_command(PROJECT)).toStrictEqual([
			resolve_local_bin(PROJECT, 'cspell'),
		])
	})

	it('falls back to pnpm exec where the root carries no shim', () => {
		expect(edited_cspell.cspell_command(DIRECTORY)).toStrictEqual(['pnpm', 'exec', 'cspell'])
	})
})

describe('run_cspell', () => {
	it(
		'reports the same unknown words as the path route',
		async () => {
			const [stdin_words, path_words] = await both_routes('checked.ts')

			expect(stdin_words).toBe(path_words)
			expect(stdin_words).toContain(UNKNOWN_WORD)
			expect(stdin_words).not.toContain(KNOWN_WORD)
		},
		LIVE_TIMEOUT_MS,
	)

	it(
		'honours the project ignore list as the path route does',
		async () => {
			const [stdin_words, path_words] = await both_routes('ignored.md')

			expect(stdin_words).toBe(path_words)
			expect(stdin_words).toBe('')
		},
		LIVE_TIMEOUT_MS,
	)

	it(
		'checks the text it is handed rather than the file on disk',
		async () => {
			const file_path = path.join(PROJECT, 'rewritten.ts')

			writeFileSync(file_path, `const ${KNOWN_WORD} = 1\n`)

			const words = await edited_cspell.run_cspell({ file_path, project_root: PROJECT, text: BODY })

			expect(words).toContain(UNKNOWN_WORD)
		},
		LIVE_TIMEOUT_MS,
	)
})
