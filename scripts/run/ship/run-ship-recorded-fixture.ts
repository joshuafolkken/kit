import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_step_section } from '#scripts/run/run-step-section'
import { vi } from 'vitest'

// joshuafolkken/kit#5003: a `josh ship --review` given no `--unpinned-ok` carries the reason recorded for
// this branch in the work tree's git directory (`run-ship-pre-detach-pinned.ts` →
// `with_recorded_reason`). A ship CLI suite run in a lane that recorded one read it, and its `--review`
// cases failed. `isolate` answers no record; `with_record` puts one for this branch where the real reader
// looks, so a case can show the suite stays apart from the checkout it runs in.
//
// `isolate` also prints no governing section, so a suite reads the ship's own report as its first
// line, whatever this session printed before.

const RECORDED_REASON = 'a reason an earlier ship on this branch recorded'
const SUCCESS_EXIT_CODE = 0

function isolate(): void {
	vi.spyOn(run_review_pinned_accepted, 'recorded_reason').mockResolvedValue(undefined)
	vi.spyOn(run_step_section, 'print_once').mockReturnValue(SUCCESS_EXIT_CODE)
}

// `run(argv)` — the ship CLI — with this branch's record in place.
async function with_record(
	run: (argv: ReadonlyArray<string>) => Promise<number>,
	argv: ReadonlyArray<string>,
): Promise<number> {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-ship-recorded-'))
	const record = { branch: await git_command.branch(), reason: RECORDED_REASON, unpinned: [] }

	stamp_file.replace_stamp(path.join(directory, run_review_pinned_accepted.RECORD_NAME), record)
	const directories = vi.spyOn(git_command, 'git_directories').mockResolvedValue([directory])

	try {
		return await run(argv)
	} finally {
		directories.mockRestore()
		rmSync(directory, { recursive: true, force: true })
	}
}

const run_ship_recorded_fixture = { isolate, with_record }

export { run_ship_recorded_fixture }
