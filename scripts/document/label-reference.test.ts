import { ALL_LABELS } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// Every label a document applies, removes or creates must be managed by this package. Scanning the
// whole document set catches mistyped `labels[]=…` before a silent run-time failure
// (joshuafolkken/kit#1923).

function unknown_labels(text: string): Array<string> {
	return document_scan.label_references(text).filter((name) => !ALL_LABELS.has(name))
}

describe('every label a document operates on exists', () => {
	it.each(all_documents())('%s operates only on real labels', (path) => {
		expect(unknown_labels(read_document(path))).toStrictEqual([])
	})

	// The guard is only worth keeping if it fails on the thing it exists to catch.
	it('flags a label that is not managed', () => {
		expect(unknown_labels('`gh api … -f labels[]=bogus-label`')).toStrictEqual(['bogus-label'])
	})

	it('accepts a real label', () => {
		expect(unknown_labels('`labels[]=in-progress` and `labels[]=route:split`')).toStrictEqual([])
	})
})
