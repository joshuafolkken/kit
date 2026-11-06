import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_session_action } from '#scripts/lane/lane-session-action'
import { run_review_pinned_steps } from '#scripts/run/review/run-review-pinned-steps'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { historical_log_evidence } from './historical-log-evidence'

const make_directory = temporary_directory()

const location = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { lane_location: location } }))

const ISSUE = 6301
const OTHER = '1'
const AT = '2026-11-04T11:00:00.000Z'
const LATER = '2026-11-04T11:01:00.000Z'
const HEADER = `=== ${AT} · started by process 123 · pnpm ===`
const fixture = { directory: '', paths: new Array<string>() }
const SHIP_KIND = 'ship-review'

beforeEach(() => {
	fixture.directory = make_directory('historical-evidence-')
	fixture.paths = [
		lane_session_action.review_paths(fixture.directory).log,
		lane_session_action.review_paths(fixture.directory, 'interaction').log,
		run_review_pinned_steps.log_path(fixture.directory),
	]
	location.mockReset().mockResolvedValue({ issue: String(ISSUE), directory: fixture.directory })
})

afterEach(() => {
	for (const source of fixture.paths) stamp_file.remove_stamp(source)
})

function write_logs(): void {
	for (const source of fixture.paths) {
		writeFileSync(source, `${HEADER}\n${JSON.stringify({ timestamp: LATER })}\nplain output`)
	}
}

it('collects ship, interaction and pinned timestamps with file lines (ac-3622d61b)', async () => {
	write_logs()

	const result = await historical_log_evidence.read(ISSUE)

	expect(location).toHaveBeenCalledWith(String(ISSUE))
	expect(result.unreadable).toEqual([])
	expect(result.evidence).toEqual(
		fixture.paths.flatMap((source, index) => [
			{
				kind: index === fixture.paths.length - 1 ? 'pinned' : SHIP_KIND,
				at: AT,
				source: `${source}:1`,
			},
			{
				kind: index === fixture.paths.length - 1 ? 'pinned' : SHIP_KIND,
				at: LATER,
				source: `${source}:2`,
			},
		]),
	)
})

it('reads no other issue log even when that log mentions this issue (ac-faea0c1f)', async () => {
	const foreign = run_review_pinned_steps.log_path(path.join(fixture.directory, OTHER))

	fixture.paths.push(foreign)
	writeFileSync(foreign, `${HEADER}\n#${String(ISSUE)}`)

	const result = await historical_log_evidence.read(ISSUE)

	expect(result.evidence).toEqual([])
	expect(result.unreadable).toEqual(fixture.paths.slice(0, -1))
})

it('rejects missing files, invalid timestamps and malformed JSON (ac-faea0c1f)', async () => {
	const [source = ''] = fixture.paths

	writeFileSync(
		source,
		'=== invalid · started by process 123 · pnpm ===\n{"timestamp":"bad"}\n{"timestamp":',
	)

	const result = await historical_log_evidence.read(ISSUE)

	expect(result.evidence).toEqual([])
	expect(result.unreadable).toEqual(fixture.paths.slice(1))
})

it.each(['1', '2026-02-30T11:00:00Z'])(
	'rejects normalized or ambiguous dates in headers and JSON: %s (ac-faea0c1f)',
	async (stamp) => {
		const [source = ''] = fixture.paths

		writeFileSync(
			source,
			`=== ${stamp} · started by process 123 · pnpm ===\n${JSON.stringify({ timestamp: stamp })}`,
		)

		const result = await historical_log_evidence.read(ISSUE)

		expect(result.evidence).toEqual([])
	},
)
