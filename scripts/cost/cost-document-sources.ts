import type { AttributedRecord, Corpus } from './cost-corpus'
import { cost_documents, type DocumentBreakdown, type DocumentSource } from './cost-documents'
import { cost_transcript, type SessionFile, type SessionUsage } from './cost-transcript'

// Turning a cost scope's sessions into the raw transcripts and records the document breakdown reads
// (joshuafolkken/kit#1871).
//
// Kept out of `cost-cli.ts`, which was at its length limit, and out of `cost-documents.ts`, which
// stays free of the corpus shape so it can be unit-tested on raw transcript text alone. This is the
// one place that knows both — where a session's transcript is read from, and which sessions a scope
// covers.

// One session contributes its transcript when the scope covers it. The records passed are the whole
// session's — so a read's position is found in the full transcript order — while `scope_ids` narrows
// the carry to the issue's own requests. Yields nothing when the scope does not cover the session, so
// `flatMap` drops it without a nesting level.
function to_source(
	file: SessionFile,
	session: SessionUsage | undefined,
	scope_ids: ReadonlySet<string> | undefined,
): Array<DocumentSource> {
	if (session === undefined || scope_ids === undefined) return []

	return [{ raw: cost_transcript.read_raw(file), records: session.records, scope_ids }]
}

// The request ids each session contributed to the issue, so the carry is charged over the issue's own
// requests rather than the whole session's — the same branch filter the rest of the issue scope uses.
function issue_request_ids(pairs: ReadonlyArray<AttributedRecord>): Map<string, Set<string>> {
	const by_session = new Map<string, Set<string>>()

	for (const pair of pairs) {
		const ids = by_session.get(pair.session_id) ?? new Set<string>()

		ids.add(pair.record.request_id)
		by_session.set(pair.session_id, ids)
	}

	return by_session
}

// The entry-read documents of every session that contributed a record to the issue, each session's
// carry counted over its issue requests and merged by document. `files` and `sessions` are
// index-aligned by `load_corpus`, so the session for a file is read at the same index.
function for_issue(corpus: Corpus, pairs: ReadonlyArray<AttributedRecord>): DocumentBreakdown {
	const by_session = issue_request_ids(pairs)
	const sources = corpus.files.flatMap((file, index) =>
		to_source(file, corpus.sessions[index], by_session.get(file.session_id)),
	)

	return cost_documents.build(sources)
}

// A whole session's entry-read documents. Undefined for a session with no readable request, so the
// breakdown is absent rather than an empty table beside a baseline that was never measured — the same
// rule `optional_measurement` follows one field over.
function for_session(file: SessionFile, session: SessionUsage): DocumentBreakdown | undefined {
	if (session.records.length === 0) return undefined

	return cost_documents.build([{ raw: cost_transcript.read_raw(file), records: session.records }])
}

const cost_document_sources = {
	for_issue,
	for_session,
}

export { cost_document_sources }
