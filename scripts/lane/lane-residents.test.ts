import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lane_residents, type ResidentProbes } from './lane-residents'

// joshuafolkken/kit#4304: a `script`-wrapped `run:board` and two `node` processes started from a
// merged lane's checkout were re-parented to pid 1 and held gigabytes after the lane closed. What is
// pinned here is which processes the close ends — those running from that lane's directory alone.

const LANE = '/w/.kit-lanes/42'
const OTHER_LANE = '/w/.kit-lanes/420'
const MAIN_CHECKOUT = '/w/kit'
const DETACHED_BOARD = 66_330
const DETACHED_NODE = 79_739
const DEEP_NODE = 66_369
const OTHER_LANE_NODE = 50_000
const MAIN_NODE = 50_001
const OWN = 60_000
const ESLINT_D = 77_412
const ALREADY_REAPED = 48_848
// The caller's helper (`tsx`'s `esbuild`) and a command piped beside it, in the caller's group.
const OWN_HELPER = 32_588
const PIPED_SIBLING = 32_480
const OWN_GROUP = 32_441
const GROUPS = new Map([
	[process.pid, OWN_GROUP],
	[OWN_HELPER, OWN_GROUP],
	[PIPED_SIBLING, OWN_GROUP],
])

function probes_over(
	directories: ReadonlyMap<number, string>,
	signalled: Array<number>,
	marks: ReadonlyMap<number, string> = new Map(),
): ResidentProbes {
	return {
		directories: () => directories,
		marks: () => marks,
		own: () => new Set([OWN]),
		groups_of: (pids) => new Map(pids.map((pid) => [pid, GROUPS.get(pid) ?? pid])),
		terminate: (pid) => {
			signalled.push(pid)

			return true
		},
	}
}

const SUBJECT = { issue: '42', directory: LANE }
const MARKED_IN_MAIN = 71_001
const MARKED_IN_TMP = 71_002
const OTHER_MARKED = 71_003
const MARKED_MACHINE = new Map([
	[DETACHED_BOARD, LANE],
	[MARKED_IN_MAIN, MAIN_CHECKOUT],
	[MARKED_IN_TMP, path.join(os.tmpdir(), 'rb42')],
	[OTHER_MARKED, MAIN_CHECKOUT],
	[MAIN_NODE, MAIN_CHECKOUT],
])
const MARKS = new Map([
	[DETACHED_BOARD, '42'],
	[MARKED_IN_MAIN, '42'],
	[MARKED_IN_TMP, '42'],
	[OTHER_MARKED, '420'],
])

const MACHINE = new Map([
	[DETACHED_BOARD, LANE],
	[DETACHED_NODE, LANE],
	[DEEP_NODE, `${LANE}/packages/app`],
	[OTHER_LANE_NODE, OTHER_LANE],
	[MAIN_NODE, MAIN_CHECKOUT],
	[OWN, LANE],
	[ALREADY_REAPED, LANE],
	[OWN_HELPER, LANE],
	[PIPED_SIBLING, `${LANE}/scripts`],
])

describe('lane_residents.end_residents', () => {
	it('terminates every process running from the lane checkout, at any depth', () => {
		const signalled: Array<number> = []
		const ended = lane_residents.end_residents(
			SUBJECT,
			[ALREADY_REAPED],
			probes_over(MACHINE, signalled),
		)

		expect(ended).toStrictEqual([DETACHED_BOARD, DETACHED_NODE, DEEP_NODE])
		expect(signalled).toStrictEqual([DETACHED_BOARD, DETACHED_NODE, DEEP_NODE])
	})

	// joshuafolkken/kit#4300: the lane's detached `eslint_d` (ppid 1, titled `eslint_d - <cwd>`) is
	// found by its working directory alone — no title is matched.
	it('terminates the lane’s detached eslint_d by its working directory', () => {
		const signalled: Array<number> = []
		const daemons = new Map([[ESLINT_D, LANE]])

		lane_residents.end_residents(SUBJECT, [], probes_over(daemons, signalled))

		expect(signalled).toStrictEqual([ESLINT_D])
	})

	it('never signals another lane’s, the main checkout’s or the caller’s own processes', () => {
		const signalled: Array<number> = []

		lane_residents.end_residents(SUBJECT, [], probes_over(MACHINE, signalled))

		expect(signalled).not.toContain(OTHER_LANE_NODE)
		expect(signalled).not.toContain(MAIN_NODE)
		expect(signalled).not.toContain(OWN)
		expect(signalled).not.toContain(OWN_HELPER)
		expect(signalled).not.toContain(PIPED_SIBLING)
	})
})

// joshuafolkken/kit#4315: two `script`-wrapped `run:board` processes a lane started from the main
// checkout sat under pid 1 for nine hours — no working directory under the lane found them, the mark did.
describe('lane_residents.end_residents — the lane mark', () => {
	it('terminates a marked process wherever it runs, once even when its directory matches too', () => {
		const ended = lane_residents.end_residents(SUBJECT, [], probes_over(MARKED_MACHINE, [], MARKS))

		expect(ended).toStrictEqual([DETACHED_BOARD, MARKED_IN_MAIN, MARKED_IN_TMP])
	})

	it('never signals an unmarked process outside the lane, nor one marked for another issue', () => {
		const ended = lane_residents.end_residents(SUBJECT, [], probes_over(MARKED_MACHINE, [], MARKS))

		expect(ended).not.toContain(MAIN_NODE)
		expect(ended).not.toContain(OTHER_MARKED)
	})

	it('spares the caller’s ancestry and group even when they carry the mark', () => {
		const marks = new Map([...MARKS, [OWN, SUBJECT.issue], [OWN_HELPER, SUBJECT.issue]])
		const ended = lane_residents.end_residents(SUBJECT, [], probes_over(new Map(), [], marks))

		expect(ended).toStrictEqual([DETACHED_BOARD, MARKED_IN_MAIN, MARKED_IN_TMP])
	})

	it('answers undefined, signalling nothing, when the marks could not be read', () => {
		const signalled: Array<number> = []
		const probes = { ...probes_over(MACHINE, signalled), marks: () => undefined }

		expect(lane_residents.end_residents(SUBJECT, [], probes)).toBeUndefined()
		expect(signalled).toStrictEqual([])
	})
})

describe('lane_residents.end_residents when a signal or the reading fails', () => {
	it('answers undefined, signalling nothing, when the working directories could not be read', () => {
		const signalled: Array<number> = []
		const probes: ResidentProbes = {
			...probes_over(MACHINE, signalled),
			directories: () => undefined,
		}

		expect(lane_residents.end_residents(SUBJECT, [], probes)).toBeUndefined()
		expect(signalled).toStrictEqual([])
	})

	it('counts only the processes the signal reached', () => {
		const probes: ResidentProbes = {
			...probes_over(MACHINE, []),
			terminate: (pid) => pid !== DETACHED_NODE,
		}

		expect(lane_residents.end_residents(SUBJECT, [], probes)).toStrictEqual([
			DETACHED_BOARD,
			DEEP_NODE,
			ALREADY_REAPED,
		])
	})

	it('spares the caller’s ancestry alone when its own group could not be read', () => {
		const probes: ResidentProbes = { ...probes_over(MACHINE, []), groups_of: () => new Map() }
		const ended = lane_residents.end_residents(SUBJECT, [ALREADY_REAPED], probes)

		expect(ended).not.toContain(OWN)
		expect(ended).toContain(OWN_HELPER)
	})
})

describe('lane_residents.residents_sentence', () => {
	it('says nothing when nothing ran from the checkout, and a failed reading as failed', () => {
		expect(lane_residents.residents_sentence([], '#42')).toBeUndefined()
		expect(lane_residents.residents_sentence(undefined, '#42')).toContain('lsof or ps failed')
	})
})

describe('lane_residents.parse_groups', () => {
	it('reads each listed process’s group, skipping a line that is not a pair', () => {
		expect(lane_residents.parse_groups('  12   12\n 345 12\nnoise\n')).toStrictEqual(
			new Map([
				[12, 12],
				[345, 12],
			]),
		)
	})
})
