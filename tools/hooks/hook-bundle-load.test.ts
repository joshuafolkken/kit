import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { hook_bundle_load } from '#tools/hooks/hook-bundle-load'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { import_bundle, run_bundle } = hook_bundle_load
const make_directory = temporary_directory()
const BUILD_ERROR = 'Transform failed'
const PROBE_KEY = 'hook_bundle_load_probe'
const LATE_CHUNK = 'chunk-late.js'
const PROBE_FILE = 'probe-hook.js'
// A hook bundle in miniature: it runs its main only when launched as `argv[1]`, as every hook does.
const PROBE_BUNDLE = [
	"import { fileURLToPath } from 'node:url'",
	`if (process.argv[1] === fileURLToPath(import.meta.url)) globalThis.${PROBE_KEY} = process.argv.slice(2)`,
].join('\n')

function create_out_directory(): string {
	const out_directory = path.join(realpathSync(make_directory('hook-bundle-load-')), 'hooks')

	mkdirSync(out_directory)

	return out_directory
}

const saved = { argv: [...process.argv] }

beforeEach(() => {
	saved.argv = [...process.argv]
})

afterEach(() => {
	process.argv = saved.argv
	Reflect.deleteProperty(globalThis, PROBE_KEY)
})

describe('import_bundle', () => {
	it('loads again once when a background build pruned a chunk the stale entry imports', async () => {
		const out_directory = create_out_directory()
		const bundle = path.join(out_directory, PROBE_FILE)
		const load = vi.fn(async (href: string) => {
			try {
				const loaded: unknown = await import(href)

				return loaded
			} finally {
				writeFileSync(path.join(out_directory, LATE_CHUNK), '')
			}
		})

		writeFileSync(bundle, `import './${LATE_CHUNK}'\n${PROBE_BUNDLE}`)
		process.argv.splice(1, process.argv.length, bundle, 'first')
		await import_bundle(bundle, load)

		expect(load).toHaveBeenCalledTimes(2)
		expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first'])
	})

	it('rethrows a failure that is not a missing file of the bundle directory', async () => {
		const load = vi.fn(async () => {
			throw new Error(BUILD_ERROR)
		})

		const bundle = path.join(create_out_directory(), PROBE_FILE)

		await expect(import_bundle(bundle, load)).rejects.toThrow(BUILD_ERROR)
		expect(load).toHaveBeenCalledOnce()
	})
})

describe('run_bundle', () => {
	it('runs the bundle main through a symlink with the hook arguments as its argv', async () => {
		const out_directory = create_out_directory()
		const bundle = path.join(out_directory, PROBE_FILE)
		const link = path.join(out_directory, 'linked-hook.js')

		writeFileSync(bundle, PROBE_BUNDLE)
		symlinkSync(bundle, link)
		await run_bundle(link, ['first', 'second'])

		expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first', 'second'])
	})
})
