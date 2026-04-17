# Git Automation Prompt

このプロンプトは、AI に一発でコミット、プッシュ、PR作成を安全に自動実行させるための指示書です。

---

## 0. Agentモード確認（最優先）

**重要**: このプロンプトを実行する前に、**必ず**Agentモードかどうかを確認すること。

### 0.1 Agentモード確認手順

1. **現在のモードを確認**
   - Askモードの場合 → **エラー停止**
   - Agentモードの場合 → 次のステップへ

2. **Askモードの場合の対応**

   ```
   🚫 現在Askモードです。このプロンプトを実行するにはAgentモードが必要です。

   以下の手順でAgentモードに切り替えてください：
   1. Cursorの設定を開く
   2. 「Agent Mode」を有効にする
   3. 再度このプロンプトを実行してください

   [処理を停止します]
   ```

3. **Agentモードの場合**
   - 確認メッセージを表示せず、直接セクション0.2に進む

### 0.2 確認完了後の処理

Agentモードであることを確認した後、以下の処理を開始する：

---

## 1. 入力フォーマット

ユーザーからの作業指示は以下のフォーマットで提供されます：

```
@git-automation.md
<issue-title> #<issue-number>
<operations>
```

### フォーマットの説明

**1行目**: プロンプトファイルの指定

- `@git-automation.md` - このプロンプトを使用することを示す

**2行目**: Issue情報

- `<issue-title>`: Issueのタイトル（例: `order praise audios`）
- `#<issue-number>`: Issue番号（例: `#194`）
- 形式: `<issue-title> #<issue-number>`

**3行目**: 実行する操作

- `commit`: コミットを実行
- `push`: プッシュを実行
- `pr`: PR作成を実行
- 複数指定可能（スペース区切り）

### 入力例

**例1**: シンプル形式

```
@git-automation.md
order praise audios #194
commit push pr
```

**解釈**:

- Issueタイトル: `order praise audios`
- Issue番号: `194`
- 実行操作: コミット、プッシュ、PR作成

**例2**: ラベル付き形式

```
@git-automation.md
issue: order praise audios #194
exec: commit push pr
```

**解釈**:

- Issueタイトル: `order praise audios`
- Issue番号: `194`
- 実行操作: コミット、プッシュ、PR作成

**注**: ラベル付き形式の場合、`issue:` と `exec:` の部分は無視して内容のみを抽出すること

### パース処理

AIは以下の手順で入力を解析すること：

1. **2行目から Issue情報を抽出**
   - `#` より前の部分 → Issueタイトル（前後の空白を削除）
   - `#` より後の部分 → Issue番号（数値のみ抽出）

2. **3行目から実行操作を抽出**
   - `commit` が含まれる → コミット実行: `yes`
   - `push` が含まれる → プッシュ実行: `yes`
   - `pr` が含まれる → PR作成実行: `yes`
   - 含まれない場合 → 該当操作: `no`

3. **セクション2のユーザー確認をスキップ**
   - フォーマットで操作が明示されているため、ユーザー確認は不要
   - 直接処理を開始する

### 注意事項

- Issue情報は必ずGitHub上の情報と照合すること（セクション3.4参照）
- タイトルが完全一致しない場合はエラー停止
- 操作が明示されていない場合は、セクション2に従ってユーザーに確認

---

## 2. 事前確認チェックリスト

以下の確認を**必ず**実行すること：

- [ ] すべての変更ファイルがステージングされているか確認
- [ ] 現在のブランチを確認
- [ ] Issue番号と Issue タイトルを取得済みか確認
- [ ] **mainブランチの最新を取得**（対象ブランチにいない場合は必須）
- [ ] **Issue番号とIssueタイトルがGitHub上に存在し、完全一致することを確認**（一致しない場合は停止）
- [ ] ブランチ作成の要否を判定（mainブランチにいる場合のみ作成）
- [ ] `package.json` の変更内容を確認（セクション4.5参照）

---

## 3. ユーザー確認項目

**重要**: 入力フォーマット（セクション1）で操作が明示されている場合は、このセクションをスキップすること。

入力フォーマットで操作が明示されていない場合のみ、以下の3つの操作について、ユーザーに実行可否を確認すること：

### 確認項目

1. **コミットを自動実行しますか？** (yes/no)
2. **プッシュを自動実行しますか？** (yes/no)
3. **PR作成を自動実行しますか？** (yes/no)

**Note**: ユーザーが "no" と回答した項目はスキップし、次の項目に進むこと。

### 判定基準

- 入力に `commit`、`push`、`pr` のいずれかが含まれている → セクション3をスキップ
- 入力に操作の指定がない → ユーザーに確認

---

## 4. 実行前の必須チェック

### 4.1 ステージング確認

**重要**: **最初に`git status`を実行して、ステージング状態を確認すること。**

すべての変更ファイルがステージングされているかを確認：

```bash
git status
```

**判定基準**:

- "Changes not staged for commit" セクションにファイルが存在する → **エラー停止**
- "Untracked files" が存在する → **エラー停止**
- "Changes to be committed" のみ存在する → **OK（次のステップへ）**

**エラーメッセージ**:

```
🚫 すべての変更ファイルがステージングされていません。
以下のコマンドでステージングしてください：
  git add .

**重要**: AIは自動的にステージングを実行してはいけません。
ユーザーが手動でステージングしてから再度実行してください。
```

**追加チェック**:

- `git status` 実行後、「Changes not staged for commit」がある場合 → **エラー停止**
- エラー停止後、AI は `git add` を実行してはならない
- ステージングの指示のみをユーザーに促す

### 4.2 現在のブランチ確認

現在のブランチを確認：

```bash
git branch --show-current
```

**判定**:

- `main` または `master` → **セクション 4.3 へ**
- その他のブランチ → **セクション 4.2.1 へ**（対象ブランチかどうかのチェックが必要）

### 4.2.1 Issue番号とブランチ番号の一致確認

**重要**: 現在のブランチが main/master 以外の場合、指定されたIssue番号とブランチ番号が一致することを確認すること。

**判定基準**:

1. 対象ブランチ名を生成（Issue番号とタイトルから、セクション5.2参照）
2. 現在のブランチ名からIssue番号を抽出（ブランチ名の先頭の数値部分）
3. 抽出したIssue番号と指定されたIssue番号を比較

**判定結果**:

| 現在のブランチ  | 指定されたIssue番号 | ブランチから抽出したIssue番号 | 処理内容       |
| --------------- | ------------------- | ----------------------------- | -------------- |
| main/master以外 | #123                | #123                          | OK（次へ）     |
| main/master以外 | #123                | #456                          | **エラー停止** |
| main/master以外 | #123                | 抽出不可                      | OK（次へ）     |

**エラーメッセージ**:

```
🚫 Issue番号とブランチ番号が一致しません。

  指定されたIssue番号: #261
  現在のブランチ:       258-add-bttf-scripts

これは誤りの可能性が高いです。正しいブランチにいることを確認してください。

対処方法:
1. 指定したIssue番号が正しいか確認
2. 正しいブランチに切り替える
3. または、新しくブランチを作成する

処理を停止します。
```

**実装例**:

```bash
# 現在のブランチを取得
CURRENT_BRANCH=$(git branch --show-current)

# ブランチ名からIssue番号を抽出（先頭の数値部分）
BRANCH_ISSUE_NUMBER=$(echo "$CURRENT_BRANCH" | grep -o '^[0-9]*' || echo "")

# 判定
if [ -n "$BRANCH_ISSUE_NUMBER" ] && [ "$BRANCH_ISSUE_NUMBER" != "$ISSUE_NUMBER" ]; then
  echo "🚫 Issue番号とブランチ番号が一致しません"
  exit 1
fi
```

### 4.3 mainブランチの最新取得

ブランチ作成前に、mainブランチの最新を取得する必要があります。

**処理フロー**:

1. 現在のブランチを確認
2. 対象ブランチ名を生成（Issue番号とタイトルから）
3. 現在のブランチが以下のいずれでもない場合、mainブランチに切り替えて最新を取得：
   - mainブランチ
   - masterブランチ
   - 対象ブランチ

**判定基準**:

| 現在のブランチ | 対象ブランチとの一致 | 処理内容                                                    |
| -------------- | -------------------- | ----------------------------------------------------------- |
| main/master    | -                    | mainブランチの最新を取得（`git pull`）                      |
| その他         | 一致する             | 何もしない（既に対象ブランチにいる）                        |
| その他         | 一致しない           | mainに切り替えて最新取得（`git checkout main && git pull`） |

**実装例**:

```bash
# 現在のブランチを取得
CURRENT_BRANCH=$(git branch --show-current)

# 対象ブランチ名を生成（Issue番号とタイトルから）
TARGET_BRANCH="123-add-dark-mode-toggle"

# 判定と処理
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  # mainブランチの最新を取得
  echo "mainブランチの最新を取得しています..."
  git pull origin main
elif [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
  # mainブランチに切り替えて最新を取得
  echo "mainブランチに切り替えて最新を取得しています..."
  git checkout main
  git pull origin main
else
  # 既に対象ブランチにいる場合は何もしない
  echo "既に対象ブランチにいます。最新取得をスキップします。"
fi
```

**エラーハンドリング**:

`git pull` でコンフリクトが発生した場合：

```
🚫 mainブランチの最新取得に失敗しました。
コンフリクトを解決してください。

エラー内容:
<git pullのエラーメッセージ>

修正方法:
1. コンフリクトを手動で解決
2. git add でステージング
3. 再度このスクリプトを実行
```

**対処**:

- エラー内容をユーザーに提示
- **エラー停止**（ユーザーに解決を依頼）

### 4.4 Issue番号とタイトルの検証

GitHub上に指定されたIssue番号とタイトルが存在し、完全一致することを確認：

```bash
gh issue view <issue-number> --json title --jq .title
```

**検証手順**:

1. ユーザーから Issue番号と Issueタイトルを取得
2. GitHub CLI で Issue情報を取得
3. 取得したタイトルとユーザーが指定したタイトルが完全一致するか確認

**判定基準**:

- Issue が存在しない → **エラー停止**
- タイトルが完全一致しない → **エラー停止**
- タイトルが完全一致する → **OK（次のステップへ）**

**エラーメッセージ例**:

```
🚫 Issue #123 が見つかりません。
Issue番号を確認してください。
```

```
🚫 Issueタイトルが一致しません。
  指定されたタイトル: Add dark mode toggle
  GitHubのタイトル:    Add darkmode toggle
Issue番号とタイトルを確認してください。
```

**実装例**:

```bash
# Issue タイトルを取得
GITHUB_TITLE=$(gh issue view 123 --json title --jq .title)

# 比較
if [ "$GITHUB_TITLE" != "Add dark mode toggle" ]; then
  echo "🚫 Issueタイトルが一致しません"
  exit 1
fi
```

### 4.5 `package.json` の変更確認

`package.json` がステージングされていない、または `version` フィールドが変更されていない場合は、ユーザーに処理続行の可否を必ず確認する。

1. ステージング済みファイルを取得し、`package.json` が含まれるか確認する。
2. 含まれていない場合は以下を表示し、ユーザーに yes/no で回答してもらう：

   ```
   ⚠️ package.json がステージング済みの変更に含まれていません。続行しますか？ (yes/no)
   ```

3. `package.json` が含まれている場合は、`git diff --cached package.json` で `version` フィールドに変更があるか確認する。
4. `version` が変更されていない場合は以下を表示し、ユーザーに yes/no で回答してもらう：

   ```
   ⚠️ package.json の version が更新されていません。続行しますか？ (yes/no)
   ```

5. ユーザーが "no" と回答した場合は即座に処理を停止し、指示を待つこと。

---

## 5. ブランチ作成（main/master にいる場合のみ）

### 5.1 Issue情報の取得

ユーザーに以下を質問：

- **Issue番号** (例: `123`)
- **Issueタイトル** (例: `Add dark mode toggle`)

### 5.2 ブランチ名の生成規則

ブランチ名: `<issue-number>-<issue-title>`

**変換ルール**:

- スペース → ハイフン (`-`)
- 記号 (`!`, `?`, `.`, `,`, `/`, `\`, `(`, `)`, `[`, `]`, `{`, `}`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, `+`, `=`, `~`, `` ` ``, `'`, `"`, `:`, `;`, `<`, `>`, `|`) → ハイフン (`-`)
- 連続するハイフン → 単一のハイフン
- 先頭・末尾のハイフン → 削除
- すべて小文字に変換

**例**:

- Issue番号: `123`
- Issueタイトル: `Add dark mode toggle!`
- 生成されるブランチ名: `123-add-dark-mode-toggle`

### 5.3 ブランチ作成コマンド

```bash
git checkout -b <branch-name>
```

**例**:

```bash
git checkout -b 123-add-dark-mode-toggle
```

---

## 6. コミット実行

### 6.1 コミットメッセージ生成規則

コミットメッセージ: `<issue-title> #<issue-number>`

**例**:

- Issueタイトル: `Add dark mode toggle`
- Issue番号: `123`
- 生成されるコミットメッセージ: `Add dark mode toggle #123`

### 6.2 コミットコマンド

```bash
git commit -m "<commit-message>"
```

**例**:

```bash
git commit -m "Add dark mode toggle #123"
```

### 6.3 lefthook エラー処理

lefthook の `pre-commit` および `commit-msg` フックが実行されます。

**エラーが発生した場合**:

1. **エラー内容を確認**し、ユーザーに提示
2. **修正方法を提案**（lefthook の fail_text を参照）
3. **実行を停止**（ユーザーに修正を依頼）
4. **⚠️ 絶対禁止**: **AIが勝手にコードを修正したり、設定ファイルを変更したりしてはいけない**

**lefthook の主なチェック項目**:

- cspell（スペルチェック）
- prettier（コードフォーマット）
- eslint（リント）
- prevent-main-commit（mainブランチへの直接コミット防止）
- check-commit-message（コミットメッセージ形式チェック）

**エラーメッセージ例**:

```
🚫 Commit blocked due to quality checks failure
Please fix the issues above and try again.

Quick fixes:
• Run `npm run format` to auto-format code
• Run `npm run lint` to check and fix linting issues
• Run `npm run check` to verify TypeScript types
```

**対処法**:

- エラー内容をユーザーに提示
- 修正コマンドを提案
- **AIは自動的にステージングを実行してはいけない**
- **AIは自動的にコードや設定ファイルを修正してはいけない**
- **AIは自動的にESLintルールを無効化してはいけない**
- ユーザーが手動で修正してから再度実行

---

## 7. プッシュ実行

### 7.1 プッシュコマンド

```bash
git push -u origin <branch-name>
```

**例**:

```bash
git push -u origin 123-add-dark-mode-toggle
```

### 7.2 lefthook エラー処理

lefthook の `pre-push` フックが実行されます。

**エラーが発生した場合**:

1. **エラー内容を確認**し、ユーザーに提示
2. **エラーの原因を分析**して報告
3. **修正方法を提案**（複数の選択肢を提示）
4. **実行を停止**（ユーザーに修正を依頼）
5. **⚠️ 重要**: **AIが勝手にコードを修正したり、コミットを変更したりしてはいけない**

**lefthook の主なチェック項目**:

- type-check（型チェック）
- test-unit（単体テスト）
- test-e2e（E2Eテスト）

**エラーメッセージ例**:

```
🚫 Push blocked due to build or test failures
Please resolve the issues above before pushing.

**エラー詳細:**
<エラー内容の詳細を記載>

**考えられる原因:**
1. <原因1>
2. <原因2>

**推奨される対処法:**

オプション1: <方法1の説明>
  コマンド: `<実行するコマンド>`

オプション2: <方法2の説明>
  コマンド: `<実行するコマンド>`

Troubleshooting:
• Check build errors: `npm run build`
• Run tests locally: `npm run test:unit` and `npm run test:e2e`

**次のステップ:**
上記のいずれかの方法で修正した後、再度プッシュを実行してください。
```

**対処法**:

- エラー内容を詳細にユーザーに提示
- エラーの原因を調査・分析して報告
- 修正方法を複数提案（可能であれば）
- **ユーザーが修正するまで処理を停止**
- **AIが自動的にコードを修正することは禁止**
- 修正後、ユーザーの指示で再度プッシュを試みる

---

## 8. PR作成

### 8.1 PR作成方法

GitHub CLI (`gh`) を使用してPRを作成：

```bash
gh pr create --title "<pr-title>" --body "<pr-body>" --label "<label>" --base main
```

### 8.2 PRタイトル

PRタイトルの形式: `<issue-title> #<issue-number>`

**例**:

```
Add dark mode toggle #123
```

### 8.3 PR本文

PR本文の形式: `closes #<issue-number>`

**例**:

```
closes #123
```

**Note**: 簡潔に `closes #<issue-number>` のみを記載する（変更内容等の追加情報は不要）

### 8.4 PRラベル

PR作成時に `enhancement` ラベルを付与する：

```bash
--label enhancement
```

### 8.5 PR作成コマンド例

```bash
gh pr create --title "Add dark mode toggle #123" --body "closes #123" --label enhancement --base main
```

### 8.6 gh コマンドが使用できない場合

`gh` コマンドがインストールされていない場合:

1. **エラーメッセージを表示**:

   ```
   ⚠️ GitHub CLI (gh) がインストールされていません。
   以下のコマンドでインストールしてください：
     brew install gh
   ```

2. **代替手段を提案**:
   ```
   または、以下のURLから手動でPRを作成してください：
   https://github.com/<owner>/<repo>/pull/new/<branch-name>
   ```

### 8.7 ステータスチェックの待機

PR作成後、ステータスチェック（CI/CD）が完了するまで待機する：

```bash
gh pr checks --watch
```

**動作**:

- ステータスチェックの進行状況をリアルタイムで表示
- すべてのチェックが完了するまで待機
- チェックが成功/失敗したら次のステップへ

**例**:

```
$ gh pr checks --watch
Some checks have not completed yet.

  ✓ Build (7s)
  ✓ Test / Unit Tests (12s)
  ✓ Test / E2E Tests (45s)
  - SonarCloud Analysis (running)
```

### 8.8 SonarCloud チェック

ステータスチェック完了後、SonarCloud の結果を確認：

```bash
gh pr checks
```

**判定基準**:

1. SonarCloud チェックの結果を確認
2. Issue や Code Smell が存在するか確認
3. 結果に応じて処理を分岐

**Issue/Code Smell が存在する場合**:

```
⚠️ SonarCloud で問題が検出されました。
以下のURLで詳細を確認し、修正してください：
<SonarCloud URL>

検出された問題:
- Bugs: X件
- Code Smells: Y件
- Security Hotspots: Z件

修正後、再度コミット・プッシュしてください。
```

**対処**:

- ユーザーに修正を依頼
- **警告終了**（処理を停止）

**Issue/Code Smell が存在しない場合**:

```
✅ すべてのチェックが正常に完了しました。

PR情報:
- URL: <PR URL>
- タイトル: <PR タイトル>
- ステータス: ✓ All checks passed

次のステップ:
コードレビューを依頼してください。
```

**対処**:

- **正常終了**として報告
- PR URLを提示

### 8.9 SonarCloud 結果の取得方法

**オプション1: gh pr checks を使用**

```bash
gh pr checks --json name,conclusion,detailsUrl
```

出力例:

```json
[
	{
		"name": "SonarCloud Analysis",
		"conclusion": "success",
		"detailsUrl": "https://sonarcloud.io/dashboard?id=..."
	}
]
```

**オプション2: SonarCloud APIを使用**

プロジェクトキーと組織から直接 SonarCloud の Issue を取得：

```bash
curl -u <token>: "https://sonarcloud.io/api/issues/search?componentKeys=<project-key>&organization=<org>"
```

**Note**: `gh pr checks` で SonarCloud のステータスが `success` であれば、基本的に問題なしと判断可能

---

## 9. 実行フロー全体像

```
開始
  ↓
[0] Agentモード確認（セクション0参照）
[1] 入力解析（セクション1参照）
  ├─ 2行目からIssue情報を抽出
  │   ├─ Issueタイトルを取得
  │   └─ Issue番号を取得
  ├─ 3行目から実行操作を抽出
  │   ├─ commit が含まれる → コミット実行フラグ: Yes
  │   ├─ push が含まれる → プッシュ実行フラグ: Yes
  │   └─ pr が含まれる → PR作成実行フラグ: Yes
  └─ 次へ
  ↓
[2] 事前確認チェック
  ├─ git status を実行してステージング状態を確認
  ├─ すべての変更ファイルがステージング済み？
  │   ├─ No（未ステージな変更あり） → エラー停止（ステージング依頼、AIはgit add禁止）
  │   └─ Yes → 次へ
  ├─ 現在のブランチを確認
  ├─ Issue情報を確認（入力から抽出済み）
  ├─ 対象ブランチ名を生成
  ├─ Issue番号とブランチ番号の一致確認（セクション4.2.1参照）
  │   ├─ ブランチ名からIssue番号を抽出
  │   ├─ 抽出されたIssue番号と指定されたIssue番号を比較
  │   ├─ 一致しない → **エラー停止**（ブランチ切り替え/新規作成依頼）
  │   └─ 一致する → 次へ
  ├─ mainブランチの最新取得
  │   ├─ main/master → git pull origin main
  │   ├─ 対象ブランチ → スキップ
  │   └─ その他 → git checkout main && git pull origin main
  │       ├─ コンフリクト発生 → エラー停止（解決依頼）
  │       └─ 成功 → 次へ
  ├─ Issue検証（GitHub上の情報と完全一致確認）
  │   ├─ Issue不存在 → エラー停止
  │   ├─ タイトル不一致 → エラー停止
  │   └─ 完全一致 → 次へ
  └─ ブランチ作成（mainブランチにいる場合のみ）
      ├─ main/master → ブランチ作成
      └─ その他 → スキップ
  ↓
[3] ユーザー確認（入力フォーマットで操作が明示されている場合はスキップ）
  ├─ 入力から実行操作が取得済み？
  │   ├─ Yes → [3]をスキップして[4]へ
  │   └─ No → ユーザーに確認
  ├─ コミット実行？
  │   ├─ Yes → コミット実行フラグ: Yes
  │   └─ No → コミット実行フラグ: No
  ├─ プッシュ実行？
  │   ├─ Yes → プッシュ実行フラグ: Yes
  │   └─ No → プッシュ実行フラグ: No
  └─ PR作成実行？
      ├─ Yes → PR作成実行フラグ: Yes
      └─ No → PR作成実行フラグ: No
  ↓
[4] コミット実行
  ├─ コミット実行フラグが Yes？
  │   ├─ Yes → コミット実行
  │   │   ├─ lefthook エラー → 停止（修正依頼）
  │   │   └─ 成功 → 次へ
  │   └─ No → スキップ
  ↓
[5] プッシュ実行
  ├─ プッシュ実行フラグが Yes？
  │   ├─ Yes → プッシュ実行
  │   │   ├─ lefthook エラー → 停止（修正依頼）
  │   │   └─ 成功 → 次へ
  │   └─ No → スキップ
  ↓
[6] PR作成実行
  ├─ PR作成実行フラグが Yes？
  │   ├─ Yes → PR作成
  │   │   ├─ gh コマンドなし → エラー（インストール依頼）
  │   │   ├─ PR作成成功 → ステータスチェック待機
  │   │   │   ↓
  │   │   │   ステータスチェック完了
  │   │   │   ↓
  │   │   │   SonarCloud結果確認
  │   │   │   ├─ Issue/Code Smell あり → 警告終了（修正依頼）
  │   │   │   └─ 問題なし → ✅ 正常終了（PR URL提示）
  │   │   └─ PR作成失敗 → エラー停止
  │   └─ No → 完了
  ↓
完了
```

---

## 10. エラーハンドリング

### 10.1 エラー分類

| エラー種別                    | 対処方法                                                     | 停止種別 |
| ----------------------------- | ------------------------------------------------------------ | -------- |
| ステージング未完了            | `git add .` を実行するよう依頼（AIは自動実行禁止）           | エラー   |
| git pull コンフリクト         | コンフリクト解決を依頼                                       | エラー   |
| Issue番号が存在しない         | Issue番号を確認するよう依頼                                  | エラー   |
| Issueタイトルが不一致         | Issue情報を修正するよう依頼                                  | エラー   |
| Issue番号とブランチ番号不一致 | 正しいブランチに切り替えまたは新規ブランチ作成を依頼         | エラー   |
| lefthook pre-commit エラー    | エラー内容と修正コマンドを提示（prettier以外は自動修正禁止） | エラー   |
| lefthook commit-msg エラー    | コミットメッセージ形式を修正依頼                             | エラー   |
| lefthook pre-push エラー      | エラー原因を分析・報告して修正方法を提案（自動修正禁止）     | エラー   |
| test-unit 失敗                | 失敗原因を分析・報告して対処法を提案（自動修正禁止）         | エラー   |
| test-e2e 失敗                 | 失敗原因を分析・報告して対処法を提案（自動修正禁止）         | エラー   |
| gh コマンド未インストール     | インストール方法または代替手段を提示                         | エラー   |
| Issue情報未取得               | Issue番号とタイトルを質問                                    | エラー   |
| SonarCloud で問題検出         | 問題詳細と修正依頼を提示                                     | 警告     |

### 10.2 エラーメッセージ例

#### ステージング未完了

```
🚫 すべての変更ファイルがステージングされていません。
以下のコマンドでステージングしてください：
  git add .

**重要**: AIは自動的にステージングを実行してはいけません。
ユーザーが手動でステージングしてから再度実行してください。
```

#### Issue番号とブランチ番号の不一致

```
🚫 Issue番号とブランチ番号が一致しません。

  指定されたIssue番号: #261
  現在のブランチ:       258-add-bttf-scripts

これは誤りの可能性が高いです。正しいブランチにいることを確認してください。

対処方法:
1. 指定したIssue番号が正しいか確認
2. 正しいブランチに切り替える
3. または、新しくブランチを作成する

処理を停止します。
```

#### git pull コンフリクト

```
🚫 mainブランチの最新取得に失敗しました。
コンフリクトを解決してください。

エラー内容:
CONFLICT (content): Merge conflict in src/routes/+page.svelte
Automatic merge failed; fix conflicts and then commit the result.

修正方法:
1. コンフリクトを手動で解決
2. git add でステージング
3. 再度このスクリプトを実行
```

#### lefthook エラー（共通）

```
🚫 <Hook種別> blocked due to <エラー種別>
<lefthook の fail_text を表示>

エラー詳細:
<エラー内容>
```

---

## 11. 必須パラメータ

### ユーザーから取得する情報

| パラメータ       | 必須条件 | 取得タイミング   | 例                     |
| ---------------- | -------- | ---------------- | ---------------------- |
| Issue番号        | 常に     | 実行フロー開始時 | `123`                  |
| Issueタイトル    | 常に     | 実行フロー開始時 | `Add dark mode toggle` |
| コミット実行可否 | 常に     | 実行フロー開始時 | `yes` / `no`           |
| プッシュ実行可否 | 常に     | 実行フロー開始時 | `yes` / `no`           |
| PR作成実行可否   | 常に     | 実行フロー開始時 | `yes` / `no`           |

**Note**:

- Issue番号とタイトルは、mainブランチ以外にいる場合でもブランチ名やコミットメッセージ作成に必要
- PR本文は `closes #<issue-number>` のみを記載するため、追加情報の取得は不要

---

## 12. 実行例

### 例1: mainブランチから新規ブランチ作成 → コミット → プッシュ → PR作成 → 正常終了

```
[AI] 現在 main ブランチにいます。Issue番号を教えてください。
[User] 123
[AI] Issueタイトルを教えてください。
[User] Add dark mode toggle
[AI] 対象ブランチ名を生成しました: 123-add-dark-mode-toggle
[AI] mainブランチの最新を取得しています...
     $ git pull origin main
     Already up to date.
     ✅ 最新取得完了
[AI] GitHub上のIssue情報を確認しています...
     $ gh issue view 123 --json title --jq .title
     ✅ Issueタイトルが一致しました
[AI] 以下の操作を実行しますか？
     1. コミット実行: yes/no
     2. プッシュ実行: yes/no
     3. PR作成実行: yes/no
[User] yes, yes, yes
[AI] ブランチを作成します...
     $ git checkout -b 123-add-dark-mode-toggle
     ✅ ブランチ作成成功
[AI] コミットを実行します...
     $ git commit -m "Add dark mode toggle #123"
     ✅ コミット成功
[AI] プッシュを実行します...
     $ git push -u origin 123-add-dark-mode-toggle
     ✅ プッシュ成功
[AI] PR を作成します...
     $ gh pr create --title "Add dark mode toggle #123" --body "closes #123" --label enhancement --base main
     ✅ PR作成成功: https://github.com/owner/repo/pull/124
[AI] ステータスチェックを待機しています...
     $ gh pr checks --watch
     ✓ Build (7s)
     ✓ Test / Unit Tests (12s)
     ✓ Test / E2E Tests (45s)
     ✓ SonarCloud Analysis (30s)
     ✅ すべてのチェックが完了しました
[AI] SonarCloud の結果を確認しています...
     $ gh pr checks --json name,conclusion,detailsUrl
     ✅ 問題は検出されませんでした

     ✅ すべてのチェックが正常に完了しました。

     PR情報:
     - URL: https://github.com/owner/repo/pull/124
     - タイトル: Add dark mode toggle #123
     - ステータス: ✓ All checks passed

     次のステップ:
     コードレビューを依頼してください。
```

### 例2: lefthook エラー発生時

```
[AI] コミットを実行します...
     $ git commit -m "Add dark mode toggle #123"
     🚫 Commit blocked due to quality checks failure
     Please fix the issues above and try again.

     Quick fixes:
     • Run `npm run format` to auto-format code
     • Run `npm run lint` to check and fix linting issues

     エラー内容:
     src/routes/+page.svelte:10:1 - error: Expected indentation of 2 spaces

[AI] エラーが発生しました。以下のコマンドで修正してください：
     $ npm run format

     修正後、再度コミットを試みますか？ (yes/no)
```

### 例3: SonarCloud で問題検出時（警告終了）

```
[AI] ステータスチェックを待機しています...
     $ gh pr checks --watch
     ✓ Build (7s)
     ✓ Test / Unit Tests (12s)
     ✓ Test / E2E Tests (45s)
     ✓ SonarCloud Analysis (30s)
     ✅ すべてのチェックが完了しました
[AI] SonarCloud の結果を確認しています...
     $ gh pr checks --json name,conclusion,detailsUrl

     ⚠️ SonarCloud で問題が検出されました。
     以下のURLで詳細を確認し、修正してください：
     https://sonarcloud.io/dashboard?id=your-project

     検出された問題:
     - Bugs: 2件
     - Code Smells: 5件
     - Security Hotspots: 0件

     修正後、再度コミット・プッシュしてください。

     [処理を停止します]
```

### 例4: Issue検証エラー発生時

```
[AI] 現在 main ブランチにいます。Issue番号を教えてください。
[User] 123
[AI] Issueタイトルを教えてください。
[User] Add dark mode toggle
[AI] 対象ブランチ名を生成しました: 123-add-dark-mode-toggle
[AI] mainブランチの最新を取得しています...
     $ git pull origin main
     Already up to date.
     ✅ 最新取得完了
[AI] GitHub上のIssue情報を確認しています...
     $ gh issue view 123 --json title --jq .title

     🚫 Issueタイトルが一致しません。
       指定されたタイトル: Add dark mode toggle
       GitHubのタイトル:    Add darkmode toggle
     Issue番号とタイトルを確認してください。

     [処理を停止します]
```

### 例5: 別ブランチからmainに切り替えて最新取得

```
[AI] 現在 feature-old ブランチにいます。Issue番号を教えてください。
[User] 456
[AI] Issueタイトルを教えてください。
[User] Fix login bug
[AI] 対象ブランチ名を生成しました: 456-fix-login-bug
[AI] mainブランチに切り替えて最新を取得しています...
     $ git checkout main
     Switched to branch 'main'
     $ git pull origin main
     Updating abc1234..def5678
     Fast-forward
      src/lib/auth.ts | 10 +++++-----
      1 file changed, 5 insertions(+), 5 deletions(-)
     ✅ 最新取得完了
[AI] GitHub上のIssue情報を確認しています...
     $ gh issue view 456 --json title --jq .title
     ✅ Issueタイトルが一致しました
[AI] 以下の操作を実行しますか？
     1. コミット実行: yes/no
     2. プッシュ実行: yes/no
     3. PR作成実行: yes/no
[User] yes, yes, yes
[AI] ブランチを作成します...
     $ git checkout -b 456-fix-login-bug
     ✅ ブランチ作成成功
[AI] コミットを実行します...
     （以下省略）
```

### 例6: git pull コンフリクト発生時

```
[AI] 現在 feature-old ブランチにいます。Issue番号を教えてください。
[User] 789
[AI] Issueタイトルを教えてください。
[User] Update dependencies
[AI] 対象ブランチ名を生成しました: 789-update-dependencies
[AI] mainブランチに切り替えて最新を取得しています...
     $ git checkout main
     error: Your local changes to the following files would be overwritten by checkout:
            package.json
     Please commit your changes or stash them before you switch branches.

     🚫 mainブランチへの切り替えに失敗しました。
     未コミットの変更があります。

     修正方法:
     1. 変更をコミットまたはstashしてください
     2. 再度このスクリプトを実行

     [処理を停止します]
```

---

## 13. チェックリスト（AI実行前）

以下を確認してから実行すること：

- [ ] `git status` でステージング状態を確認した
- [ ] 現在のブランチを確認した（`git branch --show-current`）
- [ ] Issue番号とタイトルを取得した
- [ ] 対象ブランチ名を生成した
- [ ] **Issue番号とブランチ番号の一致確認を実装した**（セクション4.2.1参照）
- [ ] **mainブランチの最新を取得した**（必要に応じて `git checkout main && git pull`）
- [ ] **git pull のエラーハンドリングを実装した**（コンフリクト等）
- [ ] **GitHub上のIssue情報と完全一致することを確認した**（`gh issue view`）
- [ ] **`package.json` の変更有無とバージョン更新の可否を確認し、必要に応じてユーザーに承認を得る処理を実装した**
- [ ] ユーザーに3つの確認項目（コミット/プッシュ/PR）を質問した
- [ ] lefthook のエラーハンドリングを実装した
- [ ] **AIの行動制限を理解した**（テスト失敗時は自動修正禁止）
- [ ] **エラー報告テンプレートを準備した**（原因分析と対処法提案）
- [ ] gh コマンドの存在確認を実装した
- [ ] PR作成後のステータスチェック待機を実装した
- [ ] **SonarCloud結果の確認と判定を実装した**

---

## 14. 注意事項

1. **Issue番号とブランチ番号の一致確認は必須**
   - main/master以外のブランチにいる場合、指定されたIssue番号とブランチ番号が一致することを確認
   - 不一致の場合は**エラー停止**してユーザーに確認
   - 誤って異なるIssue番号のブランチにコミットすることを防ぐ

2. **mainブランチの最新取得は必須**
   - ブランチ作成前に必ず実行
   - 対象ブランチにいる場合のみスキップ可能
   - git pull のエラー（コンフリクト等）は必ず処理

3. **Issue検証は必須**
   - 実行前に必ずGitHub上のIssue情報と完全一致することを確認
   - タイトルが1文字でも異なる場合は停止すること

4. **lefthook エラーは報告のみ（自動修正禁止）**
   - エラーが発生した場合は、必ずユーザーに修正を依頼し、実行を停止する
   - **prettier 以外は自動修正してはいけない**
   - エラー原因を分析し、対処法を複数提案すること

5. **テスト失敗時は自動修正禁止**
   - test-unit や test-e2e が失敗した場合
   - **AIが勝手にコードを修正してはいけない**
   - エラー原因を調査・分析して報告し、対処法を提案するのみ

6. **main/master への直接コミット/プッシュは禁止**
   - lefthook の `prevent-main-commit` がブロックする
   - 必ず新規ブランチを作成すること

7. **PR作成後は必ずステータスチェックを待機**
   - `gh pr checks --watch` でリアルタイム監視
   - すべてのチェックが完了するまで次のステップに進まない

8. **SonarCloud結果の確認は必須**
   - Issue/Code Smellが存在する場合は**警告終了**
   - 問題がない場合のみ**正常終了**として報告

9. **ユーザー確認を省略しない**
   - 3つの確認項目は必ずユーザーに質問すること
   - 勝手に実行しないこと

10. **エラーメッセージは詳細に**

- lefthook の fail_text を必ず表示
- エラー原因を分析して記載
- 修正方法を複数提示

11. **PR情報の形式を厳守**
    - PRタイトル: `<issue-title> #<issue-number>`
    - PR本文: `closes #<issue-number>`
    - ラベル: `enhancement`

---

## 15. リファレンス

### 関連ファイル

- `lefthook.yml` - Git フックの設定
- `scripts/prevent-main-commit.ts` - main ブランチへの直接コミット防止
- `scripts/check-commit-message.ts` - コミットメッセージ形式チェック

### 外部コマンド

- `git` - バージョン管理
- `gh` - GitHub CLI（PR作成に必要）
- `npm` - Node.js パッケージマネージャー

---

## 16. AIの行動制限

### 16.1 禁止事項

以下の行動は**絶対に禁止**です：

1. **ステージング未完了時の自動ステージング**
   - `git add .` を自動実行してはいけない
   - `git add <file>` を自動実行してはいけない
   - ユーザーが手動でステージングするまで停止すること
   - エラーメッセージで手動ステージングを促すのみ
   - **git status で未ステージな変更があれば、必ずエラー停止してユーザーにステージングを促すこと**

2. **lefthook エラー発生時の自動修正（prettier を除く）**
   - pre-commit、pre-push で eslint、type-check、test-unit、test-e2e のいずれかでエラーが発生した場合
   - AIが勝手にコードや設定ファイルを修正してはいけない
   - AIが勝手にESLintルールを無効化・変更してはいけない
   - エラー内容を分析し、修正方法を提案するのみ

3. **テスト失敗時の自動修正**
   - 単体テストやE2Eテストが失敗した場合
   - AIが勝手にテストコードや実装コードを修正してはいけない
   - エラー原因を調査し、対処法を提案するのみ

4. **ユーザーの承認なしのコミット変更**
   - `git commit --amend` の実行
   - `git push --force` の実行
   - これらは必ずユーザーの明示的な承認を得てから実行

5. **設定ファイルの自動変更**
   - `eslint.config.js`、`.prettierrc` などの設定ファイルをAIが勝手に変更してはいけない
   - ユーザーに修正を促すことのみ許可される

### 16.2 エラー発生時の正しい対応フロー

```
エラー発生
  ↓
エラー内容を確認・分析
  ├─ エラーログの確認
  ├─ 関連ファイルの確認
  └─ 原因の特定
  ↓
ユーザーに報告
  ├─ エラーの詳細
  ├─ 考えられる原因
  └─ 推奨される対処法（複数提示）
  ↓
処理を停止
  ↓
ユーザーが修正
  ↓
ユーザーの指示で再実行
```

### 16.3 例外ケース（自動修正が許可される場合）

以下の場合**のみ**、自動修正が許可されます：

1. **prettier のフォーマットエラー**
   - `npm run format` での自動修正は許可
   - 修正後は必ず内容をユーザーに報告
   - 修正内容をステージングして再コミット

2. **明示的な指示がある場合**
   - ユーザーが「自動で修正して」と明示的に指示した場合のみ
   - ただし、変更内容は必ず報告すること

**重要**: **設定ファイル（eslint.config.js、.prettierrcなど）の変更は、prettierのフォーマット修正でも許可されません。設定ファイルは必ずユーザーが手動で修正する必要があります。**

### 16.4 エラー報告テンプレート

lefthook pre-push でエラーが発生した場合の報告テンプレート：

````
🚫 Push blocked due to [エラー種別] failure

**エラー内容:**
<詳細なエラーメッセージを記載>

**考えられる原因:**
1. <原因1の説明>
2. <原因2の説明>
3. <原因3の説明>

**推奨される対処法:**

**オプション1**: <方法1の説明>
  手順:
  1. <ステップ1>
  2. <ステップ2>

  コマンド:
  ```bash
  <実行するコマンド>
````

**オプション2**: <方法2の説明>
手順:

1. <ステップ1>
2. <ステップ2>

コマンド:

```bash
<実行するコマンド>
```

**次のステップ:**
上記のいずれかの方法で修正した後、以下のコマンドで再度実行してください：

```bash
git push -u origin <branch-name>
```

[処理を停止します]

```

### 16.5 テスト失敗時の分析手順

E2Eテストや単体テストが失敗した場合の分析手順：

1. **失敗したテストの特定**
   - どのテストファイルのどのテストが失敗したか
   - 失敗メッセージの内容

2. **エラー原因の調査**
   - 関連するコードファイルを確認
   - 最近の変更内容を確認
   - テストが期待している状態と実際の状態の差異を特定

3. **対処法の提案**
   - コードの修正が必要な場合：修正箇所と修正内容を提案
   - テストの修正が必要な場合：テストの期待値が正しいか確認を依頼
   - ファイルの追加/削除が必要な場合：その旨を報告

4. **報告**
   - 上記の分析結果をユーザーに報告
   - **コードは修正せず、提案のみ行う**

---

## 17. Template for Future Use

新しい自動化タスクを作成する際は、このプロンプトを参考にしてください。

重要なポイント:

1. **事前確認チェックを必ず実装**
   - ステージング確認
   - ブランチ確認
   - **mainブランチの最新取得**（対象ブランチでない場合）
   - **Issue検証（GitHub上の情報と完全一致）**

2. **ユーザー確認を省略しない**
   - コミット/プッシュ/PR作成の実行可否を必ず確認

3. **エラーハンドリングを徹底**
   - git pull エラー → コンフリクト解決依頼して停止
   - lefthook エラー → 修正依頼して停止
   - Issue検証エラー → 情報修正依頼して停止
   - SonarCloud問題検出 → 修正依頼して警告終了

4. **lefthook のフックを尊重**
   - pre-commit, commit-msg, pre-push の全チェックを実行
   - エラー時は必ず停止

5. **AIの行動制限を厳守**
   - テスト失敗時は**自動修正禁止**（原因分析と提案のみ）
   - pre-push エラー時は**自動修正禁止**（prettier を除く）
   - `git commit --amend` や `git push --force` はユーザーの明示的承認が必要

6. **詳細なエラーメッセージを提示**
   - エラー内容を具体的に説明
   - エラー原因を分析
   - 修正方法を複数提示
   - 関連URLを提示（SonarCloudなど）

7. **PR作成後の処理を忘れない**
   - ステータスチェック待機（`gh pr checks --watch`）
   - SonarCloud結果確認
   - 正常終了/警告終了の明確な報告

---

## 18. 出力最適化ルール（高速化のため）

### 18.1 途中経過の報告を最小限にする

**目的**: 処理速度を向上させるため、途中経過の報告は必要最小限に抑える。

**報告ルール**:

1. **処理開始時**:
   - 入力解析結果のみを1行で報告
   - 例: `処理を開始します（Issue #194: order praise audios → commit, push, pr）`

2. **各ステップの開始時**:
   - **報告しない**（エラーが発生しない限り）

3. **各ステップの完了時**:
   - ✓ マークのみで簡潔に報告
   - 例: `✓ コミット完了`、`✓ プッシュ完了`、`✓ PR作成完了`

4. **エラー発生時**:
   - **詳細に報告**（現状維持）
   - エラー内容、原因、対処法を完全に記載

5. **最終結果**:
   - **詳細に報告**（現状維持）
   - PR URL、ステータス、次のステップを完全に記載

**NGな報告例**（冗長すぎる）:

```

✅ **ステージング確認**: 変更ファイルがステージングされています
✅ **現在のブランチ**: `194-order-praise-audios`（既に対象ブランチにいます）

対象ブランチにいるため、mainブランチの最新取得はスキップします。

次に、GitHub上のIssue情報と完全一致することを確認します。

✅ **Issue検証**: Issueタイトルが完全一致しました

既に対象ブランチにいるため、ブランチ作成はスキップします。

それでは、コミットを実行します。

✅ **コミット成功**

- ブランチチェック: 通過
- コミットメッセージチェック: 通過
- コミットID: `9406cfc`

次に、プッシュを実行します。

```

**OKな報告例**（スリム）:

```

処理を開始します（Issue #194: order praise audios → commit, push, pr）

✓ 事前チェック完了（ステージング、ブランチ、Issue検証）
✓ コミット完了（9406cfc）
✓ プッシュ完了（テスト: 137/137 pass, E2E: 25/25 pass）
✓ PR作成完了 (#195)
✓ ステータスチェック完了（11/11 pass）

---

✅ すべての処理が正常に完了しました

**PR情報:**

- URL: https://github.com/joshuafolkken/talk-svelte/pull/195
- タイトル: order praise audios #194
- ステータス: ✓ All checks passed

**次のステップ:**
コードレビューを依頼してください。

```

### 18.2 ツール呼び出し時の説明を省略

**ツール呼び出しの `explanation` パラメータ**:
- 可能な限り簡潔にする
- 「します」ではなく「確認」「実行」などの名詞形を使用
- 例: `"ステージング状態を確認します"` → `"ステージング確認"`

### 18.3 並列実行を最大化

可能な限り、依存関係のないツール呼び出しは並列実行する。
例: `git status` と `git branch --show-current` は並列実行可能。

---

## 19. サンドボックス制限回避（高速化のため）

### 19.1 目的

サンドボックスの制限により失敗するコマンドは、最初から `required_permissions: ['all']` で実行する。
これにより、リトライによる時間のロスを防ぐ。

### 19.2 常に `required_permissions: ['all']` で実行すべきコマンド

以下のコマンドは**常に** `required_permissions: ['all']` を指定すること：

1. **git commit**
   - lefthook フックがサンドボックス制限で失敗する
   - 例: `git commit -m "message"`

2. **git push**
   - lefthook フックがサンドボックス制限で失敗する
   - 例: `git push -u origin branch-name`

3. **gh コマンド全般**
   - ネットワークアクセスとTLS証明書の問題で失敗する
   - 例: `gh issue view 194 --json title --jq .title`
   - 例: `gh pr create ...`
   - 例: `gh pr checks --watch`

4. **git pull / git checkout（状況による）**
   - mainブランチの最新取得時にサンドボックス制限で失敗する可能性がある
   - 例: `git pull origin main`
   - 例: `git checkout main`

### 19.3 サンドボックスで実行可能なコマンド

以下のコマンドは通常のサンドボックスで実行可能：

1. **git status**
   - 読み取り専用のため問題なし

2. **git branch --show-current**
   - 読み取り専用のため問題なし

3. **読み取り専用のgitコマンド全般**
   - `git log`, `git diff`, `git show` など

### 19.4 実装ルール

**必須**: 以下のコマンドを実行する際は、必ず `required_permissions: ['all']` を指定すること：

```

git commit -m "..." → required_permissions: ['all']
git push -u origin ... → required_permissions: ['all']
gh issue view ... → required_permissions: ['all']
gh pr create ... → required_permissions: ['all']
gh pr checks ... → required_permissions: ['all']

```

**サンドボックスでの試行は不要**:
- 上記コマンドは最初からサンドボックス外で実行する
- リトライによる時間のロスを回避する

---

## 20. まとめ: 高速化のポイント

1. **途中経過の報告を最小化**（セクション18.1）
   - ✓ マークのみで簡潔に報告
   - エラーと最終結果のみ詳細に報告

2. **サンドボックス制限を回避**（セクション19）
   - git commit/push, gh コマンドは最初から `required_permissions: ['all']`
   - リトライによる時間ロスを防ぐ

3. **並列実行を最大化**（セクション18.3）
   - 依存関係のないコマンドは並列実行

これらのルールにより、処理時間を大幅に短縮できます。
```
