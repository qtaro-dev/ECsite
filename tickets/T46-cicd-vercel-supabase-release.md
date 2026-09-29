# T46 GitHub Actions・Vercel・SupabaseのCI/CD

**公開MVPの最新環境判断**：利用者承認の[単一Hosted DB運用](../docs/mvp-hosting-decision-2026-09-28.md)を適用する。以下の別Supabaseプロジェクト前提は後日拡張として扱い、今回の検証では1件を順次利用する。公開後のPR Previewに公開DBの秘密を渡さない。

**状態**：未着手  
**フェーズ**：M7 品質・CI/CD・公開  
**推奨実装順**：47/49（番号順ではなく[実装計画](../docs/implementation-plan.md)第3章の順序）
**一覧へ戻る**：[implementation-tickets.md](../docs/implementation-tickets.md)

**公開MVPでの追加設定**：最新の運用指示により、必須CI通過後にmainからProductionへ反映し、公開環境でT49の最終検証を行う。固定Previewの通し検証・Protection変更・Hosted接続の維持は今回の手順に含めない。単一Hosted SupabaseはProductionへ逐次切替する。切替前に未完了注文・Webhookを照合し、固定PreviewからHosted DBへ向かう通信・Cron/Webhook送信を停止してからProduction側を有効にする。通常のPR Previewには引き続きHosted資格情報を渡さない。ActionsのローカルSupabaseでDB/RLS試験を行い、匿名Auth、レート制限、T50/T51のRLSと架空データを検証する。Productionの認証省略を有効にしない。

**Hosted読み取り監査結果**：[T46 Hosted接続の読み取り監査](../docs/t46-hosted-audit-results.md)。migration履歴、匿名Auth設定、公開商品件数、Cron状態を確認済み。SSO越しのアプリ疎通、Stripe通知、Retention Cronの外部実行は未確認。

**2026-09-29の監査更新**：GitHub mainはactive ruleset `main protection`でPR必須となり、required checks `Quality gates`と`Catalog UI browser tests`が設定済みであることを公開APIで確認した。required approvalsは0。Vercel固定Preview deploymentはReady、SHA `ac7c42696c935700b36b7d25263ac605ea8cd30a`。Preview envの8変数（`ANON_CART_SIGNING_KEY`、`STRIPE_SECRET_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`AUTH_BYPASS_ENABLED`、`SMS_DELIVERY_MODE`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SITE_URL`）はすべて`codex/mvp-demo-preview` branch scopeにあり、generic Preview entryは0件と確認済み。値は記録しない。Hosted読み取りの詳細は[監査記録](../docs/t46-hosted-audit-results.md)を参照。これは監査時点の履歴であり、固定Previewの通し検証や保護方式の変更は今後行わない。SSO越しのアプリ疎通、Hosted商品一覧/匿名AuthのPreview実動作、Stripe通知は未確認のままとする。Productionは最新main基準のReady deploymentがあるが、当時の監査ではProduction環境変数が未登録だった。その後Productionへ11環境変数を登録し、Vercelの一覧で名前とSecret/Config型を確認した：`NEXT_PUBLIC_SITE_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`ANON_CART_SIGNING_KEY`、`INTERNAL_JOB_SECRET`、`T22_INTERNAL_JOB_SECRET`、`SMS_DELIVERY_MODE`、`AUTH_BYPASS_ENABLED`（Config型かつfalse）。値は記録しない。StripeテストモードにはProduction URLのWebhook endpoint（ID `we_1UKthkJwosBfexKwwFUduGVM`、4イベント）を登録済みで、live modeではない。Hosted VaultにはT22/T32で必要な4設定名（`t22_retention_url`、`t22_internal_job_secret`、`t32_reconciliation_url`、`t32_internal_job_secret`）を登録済み。秘密値は記録しない。以後、Production deployment `dpl_5kaARcHUqX7FJLuReNTwSxuoGh6n`がReadyとなり、`ecsite-jade.vercel.app` aliasへ割当済みであることを確認した。公開GET `/`はHTTP 200、GET `/api/products`はHTTP 200で18商品を返した。署名無しPOSTの内部2経路は401、Stripe Webhookは400を返した。Preview branch scopeの環境変数8件は削除済みで、Preview環境変数一覧は0件。Hosted Cronの直近30分は`t22-demo-retention`が2回、`t32-payment-reconciliation`が6回DB上で`succeeded`となった。`net._http_response`では05:45 UTCにHTTP 200が2件あり、T22/T32各Cron実行時刻と一致した。05:40 UTCには初期設定前のHTTP 503が1件記録されている。ここで確認したのはCron実行時刻とHTTP応答の相関であり、実データの削除や決済照合結果の詳細は未検証。Stripe実Checkout/実Webhook Delivery/在庫更新も未検証。

## 目的

レビューと環境分離を保って公開できるようにする。

## 対応要件ID

| ID | 要件定義書の要件 |
| --- | --- |
| QLT-01 | 主要操作、異常系、権限、在庫・金額の整合性について受け入れ条件を作る。 |
| SEC-01 | テスト用の認証省略機能と管理権限を公開環境の一般利用者に開放しない。 |
| SEC-02 | 公開デモの模擬SMSとDevelopment/Testの認証省略は別機能とする。模擬SMSでもコードの照合を必須とし、省略設定を本番環境で有効にできない。 |

要件定義書の「詳細化待ち」および古い確認待ち表記は、後続の利用者承認と詳細設計の確定内容を適用する。

## 参照する設計箇所

- [要件定義書（正本）](../output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)：上記3件の要件ID。
- [基本設計書](../output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)：§2、§12。
- [詳細設計書](../output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)：§11、§12、§13。
- [詳細設計の編集原稿](../docs/detailed-design-review.md)：同章の表・状態・例外・画面IDを実装時に確認する。
- [実装計画](../docs/implementation-plan.md)・[AGENTS.md](../AGENTS.md)：作業順序と共通ガードレール。

## 依存チケット

- [T05 CIの最小ゲート](T05-ci-baseline.md)
- [T45 全体E2Eと性能検収](T45-full-e2e-performance.md)
- **外部作業ゲート**：G-GitHub/G-Vercel/G-Supabase。接続・認証・費用が必要な段階で利用者へ具体的に提示する。

## 対象範囲

- GitHub Actions、Vercel Git連携、単一Hosted Supabaseの検証・提示間の順次切替。

## 実装内容

- 既存のCI（quality、catalog-e2e、path-filtered DB integration）を確認し、PRの必須チェックとしてmainを保護する。Actionsでは隔離したローカルSupabaseを使い、Vercel Git連携にWebデプロイを任せる。Actionsから二重デプロイしない。
- 必須CI通過後にmainをProductionへ反映する。単一Hosted SupabaseはProductionへ逐次切替する。Production接続前に固定PreviewからHosted DBへの通信とHosted向けCron/Webhook送信を停止し、通常PR Previewに資格情報がないことを確認する。Preview Protectionは変更せず、PreviewのHosted通し検証も行わない。DBマイグレーションは対象Project Refと履歴を照合して監督付きで適用し、失敗時のアプリ復旧手順を記録する。
- T49へ引き渡すProduction URL、Supabase Project Refと適用済みmigration、StripeテストWebhookのProduction受信先、必要な環境変数名を整理する。実通知確認はT49で行う。既存T49票の固定Preview手順は最新運用指示と矛盾するため、T49実施前にProduction対象へ更新する。秘密値を文書やログへ記録しない。
- 入出力・DB・権限・画面に変更がある場合は、同じチケット内で対応するOpenAPI、Zod、マイグレーション、RLS、テスト、文書を整合させる。

## 対象外

- Actionsからの二重Vercelデプロイ、無承認の有料プラン。
- 他チケットの機能と、正本にない仕様の独断追加。必要なら変更案を報告する。

## 受け入れ条件

- 必須CI通過後、Vercel Production deploymentがReadyになり、公開環境でT49の最終検証ができる。切替後のHosted Supabase接続とCron/Webhook送信先はProductionのみとする。通常PR PreviewにはHosted資格情報を渡さない。
- `main`で必要なCI status checksが必須となり、失敗時にmergeできない。Productionの決済鍵はStripeテスト鍵のみであることを確認する。
- 設計との不整合、秘密・個人情報の露出、権限の迂回がない。外部設定が未完了なら接続確認を完了扱いにしない。

## 必要なテスト

- 通常PR PreviewがHosted資格情報を受け取らないこと、必須CI通過後のmain→Production deployment、Production環境変数の設定有無とStripeテスト鍵のみであることを確認する。
- 単一Hosted SupabaseをPreviewからProductionへ順次切替する際、Preview側の接続・Webhook/Cronを先に停止し、Production側だけを有効にする。migration履歴・適用順、Webhook/Cron先、復旧・再接続手順を確認する。PreviewとProductionを同時接続しない。
- 該当する境界・異常・権限のケースを実行し、既存の関連回帰テストも通す。実行できない場合は理由を記録する。

## 完了条件

- 対象範囲の成果物と受け入れ条件が揃い、指定テストの結果を記録した。
- チケット外の変更、設計上の疑問、外部作業の未完了を隠さず報告した。
- 変更点、設計根拠、テスト結果、残課題をLUNAの完了報告に記載し、レビュー可能な差分になっている。
