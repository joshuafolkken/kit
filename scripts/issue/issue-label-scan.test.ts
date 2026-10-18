import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { issue_label_scan } from './issue-label-scan-fixture'
import { ALL_LABELS } from './issue-labels'

// joshuafolkken/kit#4103: a label kit applies or reads is one `josh start` provisions only if it is
// in `ALL_LABELS` — `issue-labels.test.ts` holds `ALL_LABELS` to `REPOSITORY_LABELS`. These scans
// hold the code to `ALL_LABELS`: `deferred` was defined and read, yet missing from it, so no
// repository `josh start` set up had it.

const { applied_label_names, label_constant_values } = issue_label_scan

const SCRIPTS_ROOT = path.resolve(import.meta.dirname, '..')
const LABELS_MODULE = path.join('issue', 'issue-labels.ts')
const BOGUS = 'bogus-label'

function source_files(): Array<string> {
	return readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' }).filter(
		(file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.includes('fixture'),
	)
}

function read_source(file: string): string {
	return readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8')
}

function unmanaged(names: ReadonlyArray<string>): Array<string> {
	return names.filter((name) => !ALL_LABELS.has(name))
}

function managed_copies(file: string): Array<string> {
	if (file === LABELS_MODULE) return []

	return label_constant_values(read_source(file)).filter((name) => ALL_LABELS.has(name))
}

function unmanaged_applied(file: string): Array<string> {
	return unmanaged(applied_label_names(read_source(file)))
}

function offenders(scan: (file: string) => Array<string>): Array<string> {
	return source_files().flatMap((file) => scan(file).map((name) => `${file}: ${name}`))
}

describe('the labels the scripts use', () => {
	it('holds every *_LABEL constant issue-labels.ts defines in ALL_LABELS', () => {
		const defined = label_constant_values(read_source(LABELS_MODULE))

		expect(unmanaged(defined)).toStrictEqual([])
	})

	it('spells no managed label name outside issue-labels.ts', () => {
		expect(offenders(managed_copies)).toStrictEqual([])
	})

	it('applies, removes and creates only labels ALL_LABELS holds', () => {
		expect(offenders(unmanaged_applied)).toStrictEqual([])
	})
})

// The scans are only worth keeping if they fail on the thing they exist to catch.
describe('issue_label_scan', () => {
	it('reads the name a *_LABEL constant holds', () => {
		expect(label_constant_values(`const X_LABEL = '${BOGUS}'\nconst Y = 'z'`)).toStrictEqual([
			BOGUS,
		])
	})

	it.each([
		["await issue_add_label(number, 'bogus-label')"],
		["await issue_remove_label(number, 'bogus-label')"],
		["pr_create(TITLE, body(), 'bogus-label')"],
		["await issue_add_label(\n\tString(number),\n\t'bogus-label',\n)"],
		["issue_create_request({ title, body, labels: ['bogus-label'] })"],
		['const RECOVERY = "gh api … -f \'labels[]=bogus-label\'"'],
	])('flags the unmanaged name in %s', (source) => {
		expect(unmanaged(applied_label_names(source))).toStrictEqual([BOGUS])
	})

	it('accepts a managed name and an imported constant', () => {
		const source = "issue_add_label(number, 'in-progress')\nissue_add_label(number, EPIC_LABEL)"

		expect(unmanaged(applied_label_names(source))).toStrictEqual([])
	})

	it('skips a label command cited in a comment', () => {
		expect(applied_label_names('// smuggled into `-f x=repos/…/labels/a`')).toStrictEqual([])
	})
})
