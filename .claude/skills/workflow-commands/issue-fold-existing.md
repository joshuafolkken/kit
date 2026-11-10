# Folding added requirements into an unstarted Issue

## Reading the candidates

Pass the whole draft — purpose, requirements and acceptance criteria — to `pnpm josh issue:scout "<title>" --body-file .josh/tmp/body.md`. An explicitly referenced `#N` is a candidate even when its title looks unrelated. `Duplicates: incomplete` means the read or the search fell short; it is not a conclusion that no candidate exists.

First record the comment thread's token with `pnpm josh issue:fold-existing --fingerprint <N>`.

Then read each candidate's body and every comment with `pnpm josh issue:read <N>`, and its state and labels with `pnpm josh issue:state <N>`. Check the linked PRs and the dependencies and run order too. When the body and a later comment disagree, the later comment wins. A failed or truncated read leaves the fold decision undetermined.

## Deciding

Match each acceptance criterion of the draft against the existing Issue. A complete duplicate is not filed and its body is not edited. A separate deliverable takes the ordinary filing path. Added requirements of its own may be folded in only when the existing Issue is open and unstarted with no PR, its dependencies and run order do not conflict, and the combined size fits the one verification pass of `split-assessment.md` → "The question". When the state or any input to the decision is unknown, do not fold.

Write the assessment as JSON and run `pnpm josh issue:fold-existing <assessment.json> --json`. `content` is `duplicate` / `compatible` / `separate` / `unknown`, and `size_verdict` is `single` / `split`. Also record `is_open`, `is_unstarted`, `has_pull_request`, `has_complete_read`, `has_dependency_conflict`, `is_separable`, `existing_body`, `draft_body`, `verification`, and `comment_fingerprint` as the token recorded before the read. `content`, `has_complete_read`, `existing_body`, `comment_fingerprint`, `draft_body` and `verification` are required; an assessment without one exits 1, and an unknown `content` is written `unknown`. Omit any other fact you do not know, and the answer is `inspect`. The assessment is evidence of the reading, never a substitute for it.

## Appending and re-reading

On a confirmed `duplicate` that stops Issue `<M>`, run `pnpm josh issue:fold-existing assessment.json --apply <N> --blocked <M>`. It records `<M>` as blocked by existing Issue `<N>` through the shared epic dependency recorder, including the tracking epic's declaration. It refuses a changed body or comment thread and reports a record failure with exit 1. Scout candidates, display-only assessment and a duplicate with no explicit stopped Issue write no dependency.

On `fold`, run `pnpm josh issue:fold-existing assessment.json --apply <N>`. It keeps the original body, appends the added requirements and how to verify them, and writes only while the body still reads as `existing_body` and the comments as `comment_fingerprint`. It applies the body's priority floor (`issue-template.md` → F) and verifies the re-read. Any answer but `folded` means the fold is not complete; on `changed`, read and assess again. A fold never creates a new Issue. `separate` returns to the ordinary filing path, and `inspect` re-reads the missing information.

An independent requirement on lane `<M>` that folds into Issue `<N>` → `pnpm josh issue:fold-existing assessment.json --apply <N> --found-during <M>`; on `folded` it also records `<N>` as `<M>`'s split child (`docs/josh-commands-backlog.md` → "`josh issue:fold-existing`").
