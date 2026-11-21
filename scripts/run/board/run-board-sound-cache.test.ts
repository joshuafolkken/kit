import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const create_directory = temporary_directory()
const FIXTURE = fileURLToPath(new URL('run-board-sound-cache-fixture.ts', import.meta.url))

function cache_process(directory: string, mode: string, bundle?: string): string {
	const args = ['--import', 'tsx', bundle ?? FIXTURE, directory, mode]
	const result = spawnSync(process.execPath, args, { encoding: 'utf8' })

	expect(result.stderr).toBe('')
	expect(result.status).toBe(0)

	return result.stdout.trim()
}

async function bundled_audio(directory: string): Promise<string> {
	const bundle = path.join(directory, 'audio.mjs')

	await build({
		entryPoints: [FIXTURE],
		bundle: true,
		platform: 'node',
		format: 'esm',
		packages: 'external',
		outfile: bundle,
	})

	return bundle
}

describe('sound cache across processes', () => {
	it('reuses source-run PCM without synthesis in a new process (ac-68d0a7ed)', () => {
		const directory = create_directory('sound-cache-source-')
		const first = cache_process(directory, 'seed')

		expect(cache_process(directory, 'hit')).toBe(first)
	})

	it('reuses bundled PCM without synthesis in a new process (ac-68d0a7ed)', async () => {
		const directory = create_directory('sound-cache-bundle-')
		const bundle = await bundled_audio(directory)
		const first = cache_process(directory, 'seed', bundle)

		expect(cache_process(directory, 'hit', bundle)).toBe(first)
	})

	it('refreshes cached PCM when the executed bundle changes (ac-68d0a7ed)', async () => {
		const directory = create_directory('sound-cache-fingerprint-')
		const bundle = await bundled_audio(directory)
		const first = cache_process(directory, 'seed', bundle)
		const changed = path.join(directory, 'changed.mjs')

		writeFileSync(changed, `export const changed = true;\n${readFileSync(bundle, 'utf8')}`)
		expect(cache_process(directory, 'seed', changed)).not.toBe(first)
	})
})
