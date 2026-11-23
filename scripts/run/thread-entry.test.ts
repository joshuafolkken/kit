import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { thread_entry } from './thread-entry'

// joshuafolkken/kit#8757: a worker script starts from its source with the TypeScript loader, or from its
// own bundle under plain node once built.

const SCRIPT = 'tools/cost-audit/cost-audit-read-worker.ts'
const ARGV = ['--max-old-space-size=4096']

describe('thread_entry.launch_of — where a worker thread starts', () => {
	it('starts the source script with the loader added when run from source', () => {
		const launch = thread_entry.launch_of(SCRIPT, false, ARGV)

		expect(launch.url).toStrictEqual(thread_entry.source_url(SCRIPT))
		expect(fileURLToPath(launch.url).endsWith(SCRIPT)).toBe(true)
		expect(launch.exec_argv.slice(0, ARGV.length)).toStrictEqual(ARGV)
		expect(launch.exec_argv.length).toBeGreaterThan(ARGV.length)
	})

	it("starts the script's bundle with the arguments as given when built", () => {
		const launch = thread_entry.launch_of(SCRIPT, true, ARGV)

		expect(fileURLToPath(launch.url).endsWith('dist/commands/cost-audit-read-worker.js')).toBe(true)
		expect(launch.exec_argv).toStrictEqual(ARGV)
	})
})
