## Step 5: PR結果確認 + 完了通知（別スクリプト）

`pnpm josh git` の後に、別スクリプト `pnpm josh followup` を実行する。

`pnpm josh followup` の主な動作:

- Cloudflare / CodeRabbit / SonarQube の結果確認（Required チェックのみ待機。CodeQL 等の non-required チェックは待たない）
- CodeRabbit 指摘の未対応検出（必要なら理由コメント投稿）
- AI レビューコメントのスキャン（Claude Review / CodeRabbit サマリコメント）。CI ステータスとは独立に実行する。ブロッカー該当コメントが残っている場合は `confirmation` Telegram 通知を送り非ゼロ終了する（`--ai-review-ignore-reason` を渡した場合のみ PR にスキップ理由コメントを投稿して続行）
- Issue への完了通知投稿（Issue body が空なら body を編集、既にあればコメント追加）
- Telegram 通知: 成功時のみ `task_type=completion`（✅）を自動送信する。CI 失敗や例外は単に再スローされるだけで、Telegram 通知は出さない。**`completion` 通知は必ずこの自動送信経路を使うこと。`pnpm josh notify --task-type completion ...` を手動で呼び出してはならない**（詳細は下記「`completion` 通知は `pnpm josh followup` 経由のみ」を参照）
- 失敗の Telegram 通知は AI ツールが **最終的に復旧を諦めた** と判断したときに限り、手動で 1 回だけ送る: `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body "<理由と未解決点>"`（再試行ごとに送らない）

主なオプション:

- `--notify-target`: `issue`（固定。PR への完了報告は行わない）
- `--notify-message`: Issue への完了コメント本文。`JOSH_SESSION_LANG` の言語（未設定なら `ja`）で、「報告フォーマット」の 2 層構造に従う — 先頭に `Cause: / Fix: / Result:` の 3 行（各 1 文、専門用語・ファイル名なし）、続けて `Details:` 以下に変更点の箇条書き。`Added ... / Changed ...` だけの羅列にしない
- `--coderabbit-ignore-reason`: 未対応を残す場合の理由コメント
- `--ai-review-ignore-reason`: AI レビュー（Claude Review / CodeRabbit サマリ）の未対応ブロッカーを残す場合の理由コメント
- `--issue-number`: Issue 番号（または位置引数に `"<title> #<number>"`）

例1: 基本（`fullrun` ではマージも込み）

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>
Cause: <why this was needed, in one plain sentence>
Fix: <what was changed, in one plain sentence>
Result: <what is different for the user now>

Details:
- Added ...
- Changed ..."
```

例2: CodeRabbit 未対応理由あり

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ...
- Fixed ..." \
  --coderabbit-ignore-reason "仕様上この指摘は該当しないため"
```

例3: AI レビュー（Claude Review）の未対応ブロッカー理由あり

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --merge \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ...
- Fixed ..." \
  --ai-review-ignore-reason "該当指摘は別 Issue #123 で追跡中のため"
```

例4: マージなし（`kickoff` 後や手動マージが必要な場合）

```bash
pnpm josh followup "<issue-title> #<issue-number>" \
  --notify-message "Implemented <title>
Cause: ...
Fix: ...
Result: ...

Details:
- Added ..."
```

### AI レビューコメントのスキャン（Claude Review / CodeRabbit サマリ）

`pnpm josh followup` は CI 完了後、`repos/{owner}/{repo}/issues/{N}/comments`（REST）で取得した PR のトップレベルコメントをスキャンし、AI レビュアーが残した未対応の指摘を検出する。**CI がオールグリーンでも、AI レビュアーのブロッカー指摘が残っていれば完了しない**。

**一時措置（kit#753）**: CodeRabbit のレビューが遅い間、CodeRabbit は全経路で非ブロッキングになっている — 既定の必須チェックから除外（`JOSH_REQUIRED_CHECKS` で復元可）、`Actionable comments posted: N` は情報ログへ格下げ、未解決の行コメントも理由なしで通過する。スキップした事実はコンソールと完了 Telegram 本文に記録される。Claude Review のブロッカー動作は従来どおり。kit#752 と併せて元に戻す。

- ブロッカー判定ヒューリスティック（保守的・構造ベース／NLP は使わない）:
  - **Claude Review**（`author.login = claude`）: 本文に `### Issues` / `### Problem` / `#### Logic bug` / `### 1. ...` などの番号付き指摘見出しを含む
  - **CodeRabbit**（`author.login = coderabbitai` / `coderabbitai[bot]`）: 本文に `Actionable comments posted: N` を含み `N > 0`。レート制限通知（`rate limited by coderabbit.ai` / `Rate limit exceeded`）や `No actionable comments` は無視する
- ブロッカーが残っていて `--ai-review-ignore-reason` が未指定の場合: `confirmation` Telegram 通知を送り、非ゼロで終了する。指摘を修正してから再実行するか、意図的に無視する理由を渡す
- `--ai-review-ignore-reason "<reason>"` を渡した場合: 無視理由コメントを PR に投稿したうえで完了通知まで進める（`--coderabbit-ignore-reason` と同じ流れ）
- **コメント一覧そのものを読めなかった場合は、ブロッカーが残っている場合と同じ扱いにする。** レート制限・認証失効・通信断はいずれも「指摘が無かった」ではなく「指摘が無かったことを誰も確認していない」であり、以前はすべて空の一覧として通過していた（joshuafolkken/kit#973）。`confirmation` Telegram 通知を送って非ゼロ終了し、読める状態で再実行する。`--ai-review-ignore-reason` はここでも通過を許す — 人が見たという意味は同じだからである。ただしその場合、スキャンを迂回した事実が完了通知の監査ノートに残る
- **CodeRabbit の行コメント一覧が読めなかった場合はブロックしない。** kit#753 により CodeRabbit はそもそもマージをブロックしないため、読めなかったことだけがブロック理由になるのは筋が通らない。警告を出し、完了通知の監査ノートに残す。なお PR 番号自体を解決できなかった場合もこちらの「読めなかった」に含まれる — 上のトップレベルコメント走査は PR 番号を解決しない

### 設定ファイル更新の確認（`pnpm josh followup` 実行中）

`pnpm josh followup` が CI ステータスチェックの処理を完了した後、`git diff main...HEAD` で PR に `josh sync` が管理・配布するファイル（`playwright.config.ts`、`.github/workflows/ci.yml` など）への変更が含まれていないかを確認する。管理設定ファイルが更新されている場合は、次のコミットの前に停止して `confirmation` Telegram 通知を送る:

```bash
pnpm josh notify --task-type confirmation --issue-url "<issue-url>" --body=$'CI ステータスチェックが管理設定ファイルの更新を検出\n変更内容を確認してから次のステップに進んでください'
```

- ユーザーから明示的な確認が得られるまで、次のコミット・修正・マージのいずれも行わない
- このチェックは AI レビューコメントのスキャンとは独立して実行する — 同一の実行中に両方がトリガーされることもある
