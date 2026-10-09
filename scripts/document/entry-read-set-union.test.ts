import { describe, expect, it } from 'vitest'
import { document_section } from './document-section'
import { entry_read_set } from './entry-read-set'

const ROOT = process.cwd()
const STEPS = 'backlogrun-steps.md'
const LATEST_GATE = 'latest-gate.md'
const HEADING_JOINER = '" + "'

function backlogrun_point_of_use(
	file: string,
): ReturnType<typeof entry_read_set.costed>['point_of_use'][number] | undefined {
	return entry_read_set.costed(ROOT, 'backlogrun').point_of_use.find((one) => one.file === file)
}

// joshuafolkken/kit#3396: `backlogrun.md`'s route table names one section of `backlogrun-steps.md` per
// row, so the point-of-use cost charges the union of those sections rather than the whole file.
describe('entry_read_set — a point-of-use document is charged at the union of its named sections', () => {
	it('charges backlogrun-steps.md at a union heading, below the whole file', () => {
		const steps = backlogrun_point_of_use(STEPS)
		const markdown = document_section.read_optional(entry_read_set.document_path(ROOT, STEPS)) ?? ''

		expect(steps?.heading).toContain(HEADING_JOINER)
		expect(steps?.cost.bytes).toBeLessThan(entry_read_set.cost_of(markdown).bytes)
	})

	it('charges latest-gate.md whole, because the route table names no section of it', () => {
		const gate = backlogrun_point_of_use(LATEST_GATE)
		const markdown =
			document_section.read_optional(entry_read_set.document_path(ROOT, LATEST_GATE)) ?? ''

		expect(gate?.heading).toBe('')
		expect(gate?.cost.bytes).toBe(entry_read_set.cost_of(markdown).bytes)
	})

	it.each(['progress-watcher.md', 'followup.md'])(
		'counts %s, which the parent reads itself, in its reach',
		(file) => {
			expect(backlogrun_point_of_use(file)?.is_resolved).toBe(true)
		},
	)
})
