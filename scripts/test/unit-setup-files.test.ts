import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unit_setup_files } from './unit-setup-files'

const { MACHINE_GUARD, STDOUT_GUARD, TELEGRAM_GUARD, WORKER_GUARDS } = unit_setup_files

describe('unit_setup_files', () => {
	it('names only setup files that exist in the repository', () => {
		const missing = Object.values(unit_setup_files)
			.flat()
			.filter((file) => !existsSync(file))

		expect(missing).toEqual([])
	})

	it('arms the stdout, Telegram and machine guards in every worker', () => {
		expect(WORKER_GUARDS).toEqual([...STDOUT_GUARD, ...TELEGRAM_GUARD, ...MACHINE_GUARD])
	})
})
