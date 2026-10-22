import { describe, expect, it } from 'vitest'
import type { TestSpecification } from 'vitest/node'
import { duration_sequencer } from './duration-sequencer'
import { duration_shard, type Durations } from './duration-shard'

// joshuafolkken/kit#4467: `--shard` hands each shard the files the duration split assigns it.

const ROOT = '/repository'
const COUNT = 3
const RECORDED: ReadonlyArray<[string, number]> = [
	['a.test.ts', 90],
	['b.test.ts', 60],
	['c.test.ts', 50],
	['d.test.ts', 40],
]
const DURATIONS: Durations = Object.fromEntries(RECORDED)
const FILES = RECORDED.map(([file]) => file)

// The one field of a specification the split reads.
function spec(file: string): TestSpecification {
	return { moduleId: `${ROOT}/${file}` } satisfies Partial<TestSpecification> as TestSpecification
}

function files_of(specs: ReadonlyArray<TestSpecification>): Array<string> {
	return specs.map((specification) => specification.moduleId.slice(ROOT.length + 1))
}

describe('duration_sequencer.shard_specs — the specifications of one shard', () => {
	it('answers the files the duration split assigns to that shard', () => {
		const specs = FILES.map((file) => spec(file))
		const expected = duration_shard.assign(FILES, DURATIONS, COUNT)

		for (const [offset, files] of expected.entries()) {
			const shard = { index: offset + 1, count: COUNT }

			expect(files_of(duration_sequencer.shard_specs(specs, shard, ROOT, DURATIONS))).toStrictEqual(
				FILES.filter((file) => files.includes(file)),
			)
		}
	})

	it('runs every file across the shards exactly once', () => {
		const specs = FILES.map((file) => spec(file))
		const all = Array.from({ length: COUNT }, (_, offset) =>
			files_of(
				duration_sequencer.shard_specs(specs, { index: offset + 1, count: COUNT }, ROOT, DURATIONS),
			),
		).flat()

		expect(all.toSorted((left, right) => left.localeCompare(right))).toStrictEqual(FILES)
	})
})
