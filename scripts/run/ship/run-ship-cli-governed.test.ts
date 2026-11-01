import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_supervised } from './run-ship-supervised'

// joshuafolkken/kit#5626: `ship` prints its governing section before anything else, and a print that
// fails (a heading renamed away) stops the ship, so no stage runs unread. The print's own branches —
// the supervised skip, the once-per-session line — are pinned in `run-ship-supervised.test.ts` and
// `run-step-section-once.test.ts`.

const PRINT_FAILURE = 1
const TITLE = 'Print the governing section #5626'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_cli.run — the governing section', () => {
	it('stops with the print exit code before a detach when the section does not print', async () => {
		vi.spyOn(run_ship_supervised, 'print_section').mockReturnValue(PRINT_FAILURE)
		vi.spyOn(run_ship_body_draft, 'with_draft').mockImplementation(async (args) => args)
		const detach = vi.spyOn(run_ship_detach, 'detach')

		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(PRINT_FAILURE)
		expect(detach).not.toHaveBeenCalled()
	})
})
