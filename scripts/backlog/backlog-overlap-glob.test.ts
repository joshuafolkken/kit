import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'
import { backlog_overlap_glob } from './backlog-overlap-glob'

// joshuafolkken/kit#8529: joshuafolkken/kit#8434 declared its tests as `run-board-cli*.test.ts` and
// waited behind joshuafolkken/kit#8442, which named only other files of that directory.

const { REPO } = backlog_fixture
const CANDIDATE = 8434
const RUNNING = 8442
const BOARD_TESTS = 'scripts/run/board/run-board-cli*.test.ts'
const RUN_GLOB = 'scripts/run/**'
const KEYS_TEST = 'scripts/run/board/run-board-cli-keys.test.ts'
const REVEAL_BODY =
	'- `scripts/run/board/run-board-reveal-rain.ts` と `scripts/run/board/run-board-reveal-rain.test.ts`'
const CANDIDATE_BODY = `- \`scripts/run/board/run-board-cli.ts\` を直し、\`${BOARD_TESTS}\` を足す`

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

function busy(number: number): BusyRead {
	return {
		kind: 'busy',
		issues: [{ number, title: 'running', createdAt: '2026-11-21T00:00:00Z', blockedBy: undefined }],
	}
}

// The candidate weighed against a running issue whose body is `running_body`.
function weighed(running_body: string): ReturnType<typeof backlog_overlap.separate> {
	const declared = backlog_overlap.declared_of([
		{ number: RUNNING, body: running_body },
		{ number: CANDIDATE, body: CANDIDATE_BODY },
	])
	const selection = { offered: [child(CANDIDATE)], withheld: [] }

	return backlog_overlap.separate(selection, declared, { read: busy(RUNNING), repo: REPO })
}

function clash_with(running_body: string): ReturnType<typeof backlog_overlap.running_clash> {
	const declared = backlog_overlap.declared_of([
		{ number: RUNNING, body: running_body },
		{ number: CANDIDATE, body: CANDIDATE_BODY },
	])

	return backlog_overlap.running_clash(child(CANDIDATE), declared, {
		holders: [RUNNING],
		repo: REPO,
	})
}

describe('backlog_overlap — a glob claim against the files of its directory', () => {
	it('offers a glob candidate beside a running issue on other files of that directory', () => {
		expect(weighed(REVEAL_BODY).withheld).toStrictEqual([])
		expect(clash_with(REVEAL_BODY)).toBeUndefined()
	})

	it('holds the glob candidate back behind a running issue naming a file it matches', () => {
		expect(weighed(`- \`${KEYS_TEST}\``).withheld).toStrictEqual([child(CANDIDATE)])
		expect(clash_with(`- \`${KEYS_TEST}\``)).toStrictEqual({
			path: BOARD_TESTS,
			claimed: KEYS_TEST,
			holder: RUNNING,
		})
	})
})

describe('backlog_overlap_glob.meets', () => {
	it('matches a file by the pattern, whether or not the file exists yet', () => {
		expect(
			backlog_overlap_glob.meets(BOARD_TESTS, 'scripts/run/board/run-board-cli-new.test.ts'),
		).toBe(true)
		expect(backlog_overlap_glob.meets(BOARD_TESTS, 'scripts/run/board/run-board-cli-new.ts')).toBe(
			false,
		)
	})

	it('meets a directory either glob prefix sits in or under', () => {
		expect(backlog_overlap_glob.meets(BOARD_TESTS, 'scripts/run/')).toBe(true)
		expect(backlog_overlap_glob.meets(RUN_GLOB, 'scripts/run/board/')).toBe(true)
		expect(backlog_overlap_glob.meets(BOARD_TESTS, 'scripts/backlog/')).toBe(false)
	})

	it('meets another glob when either fixed prefix starts the other', () => {
		expect(backlog_overlap_glob.meets(BOARD_TESTS, 'scripts/run/board/run-board-*.ts')).toBe(true)
		expect(backlog_overlap_glob.meets(RUN_GLOB, BOARD_TESTS)).toBe(true)
		expect(backlog_overlap_glob.meets(BOARD_TESTS, 'scripts/run/board/run-board-reveal*.ts')).toBe(
			false,
		)
	})
})
