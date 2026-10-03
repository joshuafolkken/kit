# Folding added requirements into an unstarted Issue

## Reading the candidates

Pass the whole draft — purpose, requirements and acceptance criteria — to `pnpm josh issue:scout "<title>" --body-file <draft.md>`. An explicitly referenced `#N` is a candidate even when its title looks unrelated. `Duplicates: incomplete` means the read or the search fell short; it is not a conclusion that no candidate exists.

Read each candidate's body and every comment with `pnpm josh issue:read <N>`, and its state and labels with `pnpm josh issue:state <N>`. Check the linked PRs and the dependencies and run order too. When the body and a later comment disagree, the later comment wins. A failed or truncated read leaves the fold decision undetermined.

## Deciding

Match each acceptance criterion of the draft against the existing Issue. A complete duplicate is neither filed nor edited. A separate deliverable takes the ordinary filing path. Added requirements of its own may be folded in only when the existing Issue is open and unstarted with no PR, its dependencies and run order do not conflict, and the combined size fits the one verification pass of `split-assessment.md` → "The question". When the state or any input to the decision is unknown, do not fold.

Write the assessment as JSON and run `pnpm josh issue:fold-existing <assessment.json> --json`. `content` is `duplicate` / `compatible` / `separate` / `unknown`, and `size_verdict` is `single` / `split`. Also record `is_open`, `is_unstarted`, `has_pull_request`, `has_complete_read`, `has_dependency_conflict`, `is_separable`, `existing_body`, `draft_body` and `verification`. Omit a fact you do not know, and the answer is `inspect`. The assessment is evidence of the reading, never a substitute for it.

## Appending and re-reading

On `fold`, the proposed `body` keeps the original body and appends the added requirements and how to verify them. Immediately before writing, confirm the body and comments have not changed since the assessment; if they have, assess again.

```bash
pnpm josh issue:fold-existing assessment.json --json > result.json
jq -e '.verdict == "fold"' result.json
jq '{body: .body}' result.json > patch.json
gh api -X PATCH repos/{owner}/{repo}/issues/<N> --input patch.json
pnpm josh issue:read <N>
```

Re-read it and confirm the original requirements, the decisions recorded in comments, the added requirements and the verification all remain. A failed write or re-read means the fold is not complete. A fold never creates a new Issue. `separate` returns to the ordinary filing path, and `inspect` re-reads the missing information.
