import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_progress_cli } from './run-progress-cli'

// joshuafolkken/kit#2480: `--output` handed over as one joined argument is refused as a usage error, and
// the refusal has to say the watcher never started — read as started, it left a person without
// progress. Exercised on its own because `run-progress-cli.test.ts` is at its line limit.

const warned: Array<string> = []

beforeEach(() => {
	warned.length = 0
	vi.spyOn(console, 'error').mockImplementation((...args) => {
		warned.push(args.join(' '))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh run:progress — a usage error', () => {
	it('exits non-zero and says nothing is relaying progress', async () => {
		await expect(run_progress_cli.run(['--wait --output a.jsonl'])).resolves.toBe(1)

		expect(warned.join('\n')).toContain('did not start, so nothing is relaying progress')
	})
})
