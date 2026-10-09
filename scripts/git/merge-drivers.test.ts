import type node_fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3517: the `-c` options `josh main:merge` passes register the metrics baseline's
// driver where its script is on disk (kit's checkout), and nothing where the published package left
// `scripts/metrics/` out.

const exists = vi.hoisted(() => ({ value: true }))

vi.mock('node:fs', async (import_original) => {
	const actual = await import_original<typeof node_fs>()

	function exists_sync(file_path: node_fs.PathLike): boolean {
		if (String(file_path).endsWith('metrics-merge-driver.ts')) return exists.value

		return actual.existsSync(file_path)
	}

	return { ...actual, existsSync: exists_sync }
})

const { merge_drivers } = await import('./merge-drivers')

describe('merge_drivers.git_options — the drivers registered for one merge', () => {
	it('registers the josh-metrics driver on the script under scripts/metrics', () => {
		exists.value = true

		const options = merge_drivers.git_options()

		expect(options.filter((option) => option === '-c')).toHaveLength(2)
		expect(options.at(-1)).toMatch(
			/^merge\.josh-metrics\.driver=.*"[^"]*metrics-merge-driver\.ts" %O %A %B$/u,
		)
	})

	it('registers nothing where the driver script is not shipped', () => {
		exists.value = false

		expect(merge_drivers.git_options()).toEqual([])
	})
})
