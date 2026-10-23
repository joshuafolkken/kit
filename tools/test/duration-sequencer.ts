import { duration_shard, type Durations } from '#tools/test/duration-shard'
import { unit_duration_record } from '#tools/test/unit-duration-record'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

// The unit suite's sequencer: vitest's own ordering, with `--shard` split by recorded duration
// (`duration-shard.ts`, joshuafolkken/kit#4467) instead of by file count.

interface Shard {
	index: number
	count: number
}

function shard_specs(
	specs: ReadonlyArray<TestSpecification>,
	shard: Shard,
	root: string,
	durations: Durations = unit_duration_record.read(root),
): Array<TestSpecification> {
	const files = specs.map((spec) => unit_duration_record.relative_file(root, spec.moduleId))
	const chosen = new Set(duration_shard.shard_files(files, durations, shard.index, shard.count))

	return specs.filter((_, index) => chosen.has(files[index] ?? ''))
}

class DurationSequencer extends BaseSequencer {
	override async shard(files: Array<TestSpecification>): Promise<Array<TestSpecification>> {
		const { config } = this.ctx

		if (config.shard === undefined) return files

		return shard_specs(files, config.shard, config.root)
	}
}

const duration_sequencer = { DurationSequencer, shard_specs }

export { duration_sequencer }
