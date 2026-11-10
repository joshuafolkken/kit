import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { source_recorder } from './build-hooks'
import { source_location, SOURCE_LOCATION_DEFINE } from './source-location'

const OUT_DIRECTORY = path.join('/package', 'dist', 'commands')
const SOURCE_FILE = path.join('/package', 'scripts', 'run', 'board', 'run-board.ts')
const BUILD_TIMEOUT = 30_000

const locate = source_location(OUT_DIRECTORY)

describe('source_location — the prelude transform', () => {
	it('leaves a module that never reads import.meta untouched', () => {
		const source = 'export const value = 1\n'

		expect(locate(source, SOURCE_FILE)).toBe(source)
	})

	it('points the module at its source, relative to the output directory', () => {
		const located = locate('console.info(import.meta.url)\n', SOURCE_FILE)

		expect(located).toContain('"../../scripts/run/board/run-board.ts"')
	})

	// Prepended to the first line rather than added as lines of its own, so stack traces still match.
	it('keeps the line count, and a shebang on the first line', () => {
		const source = '#!/usr/bin/env tsx\nconsole.info(import.meta.url)\n'
		const located = locate(source, SOURCE_FILE)

		expect(located.startsWith('#!/usr/bin/env tsx\n')).toBe(true)
		expect(located.split('\n')).toHaveLength(source.split('\n').length)
	})
})

const create_directory = temporary_directory('test')

function write_source(root: string, relative: string, text: string): string {
	const file = path.join(root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, text)

	return file
}

// Two entries share one module, so splitting moves it into a chunk whose own URL is a `chunk-*.js`.
function write_fixture(root: string): ReadonlyArray<string> {
	const shared = 'export const where = import.meta.url\nexport const dir = import.meta.dirname\n'
	const entry =
		"import { dir, where } from './deep/shared.ts'\nconsole.info(where)\nconsole.info(dir)\n"

	write_source(root, 'src/deep/shared.ts', shared)

	return [write_source(root, 'src/first.ts', entry), write_source(root, 'src/second.ts', entry)]
}

describe('source_location — a chunked module under plain node', () => {
	it(
		'reads its source URL and directory, not the chunk it landed in',
		async () => {
			const root = create_directory('source-location-')
			const out_directory = path.join(root, 'out')

			await build({
				entryPoints: [...write_fixture(root)],
				outdir: out_directory,
				bundle: true,
				splitting: true,
				platform: 'node',
				format: 'esm',
				define: SOURCE_LOCATION_DEFINE,
				plugins: [source_recorder(new Map(), source_location(out_directory))],
			})
			const result = spawnSync('node', [path.join(out_directory, 'first.js')], { encoding: 'utf8' })
			// Real, because node and esbuild both resolve through a symlinked temp root.
			const shared = path.join(realpathSync(root), 'src', 'deep', 'shared.ts')

			expect(result.stdout).toBe(`${pathToFileURL(shared).href}\n${path.dirname(shared)}\n`)
		},
		BUILD_TIMEOUT,
	)
})
