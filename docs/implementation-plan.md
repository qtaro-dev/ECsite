# 自作PCパーツECサイト 実装計画（レビュー版）

**版** 0.9 ／ **作成日** 2026年9月25日 ／ **状態** 実装前の計画。製品実装、外部アカウント作成、デプロイは未実施。  
**チケット索引** `docs/implementation-tickets.md` ／ **個別チケット** `tickets/Txx-*.md` ／ **2エージェント実行計画** [担当割当・実行計画](multi-agent-execution-plan.md) ／ **進捗** [HTML一覧](implementation-status.html) ／ **環境手順** `docs/environment-setup.md` ／ **AIガードレール** `AGENTS.md`

## 1. 正本と到達目標

要件の正本は`output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf`。基本設計は`output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf`、詳細設計は`output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf`（編集原稿`docs/detailed-design-review.md`）を継承する。送料940円、重量物の公式運賃加算、公開デモ個人情報の30日削除は詳細設計時に利用者が承認済みである。文書の古い「未決定」記載より、この承認済み内容を優先する。設計変更は実装担当が独断で行わない。

到達点は、公開ポートフォリオとして使える8カテゴリの模擬ECである。商品探索、基本5種の互換性、匿名カート、会員登録とGoogleログイン、模擬SMS、配送先、注文・在庫引当、Stripeテスト決済、注文履歴、管理、異常系、CI/CD、Vercel公開と運用を含む。実販売・実課金・実発送、利用者向け取り置き、ゲスト注文、構成保存は含まない。

## 2. 進め方と1チケットの完了条件

LUNAはチケットIDを1件だけ受け取り、依存を確認してから作業する。原則として1チケット＝1レビュー可能な変更単位とし、コード・SQL・テスト・ドキュメントを同時に完結させる。外部設定が必要なチケットは、利用者作業が終わるまでローカル実装と模擬試験だけ進め、接続確認を未完了として明示する。番号は参照IDであり、依存により一部は番号順と異なる。

共通の完了条件は、①目的と対象範囲に一致、②受け入れ条件を満たす、③チケット指定テストと関連回帰テストが成功、④秘密・個人情報がログやGitに出ない、⑤設計差分と未解決事項を報告、⑥レビュー可能な変更単位であること。テストを弱めたり異常系を削ったりして合格にしない。

## 3. 実装の順序とゲート

| 段階 | チケット | 終了時に確認すること |
| --- | --- | --- |
| M0 契約と土台 | T01–T05 | ローカルGit・アプリ雛形、ワイヤー、OpenAPI、Zod基礎、CI基礎。外部接続なしでレビュー可能。 |
| M1 データと権限 | T06–T11 | SQLマイグレーション、RLS、Storage権限、初期テストデータ、競合試験の土台。 |
| M2 公開カタログ | T12–T16 | UIトークン、検索、カテゴリ・詳細、各画面の空・エラー状態。 |
| M3 認証と会員 | T17–T21 | Supabase Auth、Google、メール、模擬SMS、配送先。T22の削除は決済処理後に実施。 |
| M4 構成とカート | T23–T27 | 5種の互換性、匿名／会員カート、送料計算器、構成UI、概算送料。T27はT26の前に実施。 |
| M5 金額と購入 | T28–T35、T22 | 正式見積、原子的在庫引当、Stripeテスト決済、Webhook、期限処理、30日削除、履歴、通知。 |
| M6 管理 | T36–T41 | 管理権限、商品・在庫・注文・送料・SMTP設定。 |
| M7 品質と公開 | T42–T47 | デモ異常系、レスポンシブ・アクセシビリティ、セキュリティ・RLS、E2E、CI/CD、公開・運用。 |

単独担当での着手の推奨順序は、`T01–T18 → T20 → T19 → T21 → T23 → T25 → T27 → T24 → T26 → T28–T34 → T22 → T35–T47`である。2エージェント運用では依存を満たすT12やT06をT05前後に進められる。依存関係の詳細はチケット本体を正とする。Vercel、Supabase、Google、Stripe、SMTP等の外部作業は対応するチケットの直前に提示する。外部サービスの有料契約を前提とする作業は、名称・見積・代替案を示して利用者確認後に進める。

LUNA-A/Bを同時投入する場合は、上記の直列推奨順ではなく[マルチエージェント担当割当・実行計画](multi-agent-execution-plan.md)のWaveを運用順とする。各チケット固有の依存は維持し、独立した領域だけ並行させる。実装済みかどうかは[HTML進捗一覧](implementation-status.html)に表示する。

## 4. 実装前に固定する技術上の選択

設計で選択肢として残った範囲を、仕様を変えない形で次のように固定する。アプリは単一のNext.jsプロジェクト、`src/app`をルートとする。商品検索は初期版ではPostgresの構造化条件と`pg_trgm`による名前・メーカー検索を使う。構成選択は共有可能なURLクエリに持ち、保存はしない。Supabaseの権限付けはRLSと限定されたDB関数、SMTP秘密はSupabase Vaultの保護参照を第一候補とし、実際の利用可能性をT20/T41で確認する。Stripe Checkoutはホスト型画面を使う。GitHub Actionsは検証、Vercel Git連携はアプリのデプロイを担当し、二重デプロイを避ける。Supabase PreviewとProductionは別プロジェクトを使い、PRごとのSupabase Branchingは前提にしない。

技術選択がサービス仕様・金銭・個人情報・セキュリティを変えると判明した場合は決定を停止し、影響を報告する。上記の検索・構成状態・Vaultは実装チケットで検証する技術案であり、不可なら同等の保護と振る舞いを満たす代案をレビューに出す。

## 5. GitHubとディレクトリの初期構成

T01で既存の設計資料を保持してGitリポジトリを初期化する計画である。`main`を公開用、`feature/Txx-*`を作業用とし、PRでレビューする。`.gitignore`は`.env*`の実値、Supabase CLI一時ファイル、テスト結果、ビルド成果物を除外するが、`.env.example`は追跡する。`README.md`にはデモの非販売説明、設計資料、ローカル起動、テスト、外部設定の必要性を記す。`AGENTS.md`と設計資料を同じリポジトリで版管理する。T05で`.github/workflows/ci.yml`を追加し、後にT46でDB適用・デプロイ運用を組み込む。

予定構成は`src/app/(shop)`、`src/app/admin`、`src/app/api`、`src/components`、`src/styles`、`src/features`、`src/server`、`src/lib`、`supabase/migrations`、`supabase/seed.sql`、`tests/unit`、`tests/integration`、`tests/e2e`、`docs/api`、`docs/wireframes`。ディレクトリ責務は`AGENTS.md`に従う。まだディレクトリや製品コードは作らない。

## 6. 設計成果物を作るタイミング

| 成果物 | 主担当チケット | 完了条件 |
| --- | --- | --- |
| PC／タブレット／スマートフォンの画面ワイヤー | T02 | S01–S17、A01–A06の主要導線・異常状態を示し、詳細設計の色とブレークポイントに対応する。 |
| Zodスキーマ | T04、各APIチケット | 共通の入力・応答・エラー契約を定義し、サーバー側で必ず再検証する。 |
| SQLマイグレーション | T06–T08、以降のDB変更チケット | 詳細設計の型・制約・索引・状態遷移に対応し、ローカル再構築できる。 |
| RLSポリシーSQL | T09–T10 | 匿名・会員A/B・管理者の許可／拒否試験を持つ。 |
| OpenAPI | T03、各APIチケット | 入出力・認証・エラーが実装と一致し、差分がPRで確認できる。 |
| テストデータ定義 | T11 | 互換／不一致／不明、在庫切れ／競合、送料・税境界、Stripe成功／失敗を再現できる。実個人情報を含まない。 |

## 7. レビュー・リリース判定

PRでは要件IDとチケットID、変更範囲、受け入れ条件、テスト結果、画面差分、DB/RLS影響、環境変数変更、データ移行・復旧方法を記載する。M5終了時に購入の正常系・異常系を通し、M7でPC／タブレット／スマホ・権限・金額・競合・Webhook・削除を再確認する。公開は、Stripeライブ鍵不在、実SMS不送信、Preview/Production分離、個人情報30日削除、規約表示、料金出典、バックアップ保持条件の確認後とする。

## 8. 進行を止めるべき条件

- 正本間の矛盾、料金・個人情報・認証・在庫・公開範囲の仕様変更が必要。
- 外部サービスが有料契約を要求する、または無料枠で設計の保護条件を満たせない。
- Supabaseのバックアップを含め30日個人情報削除を保証できない。
- PreviewとProductionのDB、SMTP送信先、Stripeテストデータ、秘密が分離できない。
- CIまたはRLS・金額・在庫の重要テストが失敗している。

これらは該当するチケットの作業を止め、具体的な状況と選択肢を利用者に報告する。無関係なローカル作業は続けてよい。

## 9. 公式手順への参照

- [Vercel Git連携](https://vercel.com/docs/git)、[環境変数](https://vercel.com/docs/environment-variables)
- [Supabase CLIのローカル開発](https://supabase.com/docs/guides/local-development/cli-workflows)、[DBマイグレーション](https://supabase.com/docs/guides/deployment/database-migrations)、[環境管理](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase Auth Redirect URL](https://supabase.com/docs/guides/auth/redirect-urls)、[Googleログイン](https://supabase.com/docs/guides/auth/social-login/auth-google)、[Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
- [GitHub Actionsの環境](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)、[ワークフロー構文](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
