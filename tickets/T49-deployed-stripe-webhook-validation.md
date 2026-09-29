# T49 Production公開環境でのStripeテストWebhook実通知検証

**公開MVPの最新環境判断**：最新の利用者指示に従い、CI通過後にProduction（`ecsite-jade.vercel.app`）へ反映した公開環境で最終確認する。従前の固定Previewでの通し検証やPreview Protection変更を前提条件にしない。Hosted Supabaseは[単一DB運用](../docs/mvp-hosting-decision-2026-09-28.md)の切替手順に従い、接続先と未処理決済を確認する。Stripeはテストモードだけを使い、ライブ鍵・実課金・実発送は行わない。

**公開MVPの検証対象**：[公開MVP計画](../docs/mvp-release-plan.md)のT50/T51デモ会員と架空データによる実Stripeテスト通知を使用する。実住所・実メール・ライブ決済鍵を使わず、Hosted Checkoutが求める入力項目も確認する。

**状態**：未着手（Production実通知・外部環境の確認前）

**フェーズ**：M7 品質・CI/CD・公開 / F7 W36

**推奨実装順**：CI成功・Production反映後、T47の公開判断前

**担当**：LUNA-A
**一覧へ戻る**：[implementation-tickets.md](../docs/implementation-tickets.md)

## 目的

T31で実装した署名検証・決済状態更新を、CI通過後のVercel Production（`ecsite-jade.vercel.app`）、現在のHosted Supabase、Stripe**テストモード**の組合せで実通知により確認する。実際の公開URL上で、UIからのCheckout開始、Stripe Dashboardの署名済みイベント配送、Vercel応答、Supabaseの注文・決済・引当・在庫状態を同じ架空注文について突合する。ローカルDocker Desktop、ローカルSupabase、Stripe CLIを前提にしない。

## 対応要件ID

| ID | 要件・根拠 |
| --- | --- |
| ORD-07 | 決済成功・失敗と利用者への次の操作を検証する。 |
| ORD-08 | 決済、注文、送料・税、在庫の状態遷移を検証する。 |
| INV-02 | 成功時の引当消費と失敗・期限切れ時の解放を確認する。 |
| INV-03 | 重複・遅延通知で在庫が二重更新されないことを確認する。 |
| SEC-01 | 署名、秘密、管理権限、環境とデータの境界を守る。 |
| QLT-01 | 公開環境で再現できる検証証拠を残す。 |
| USR-STRIPE-01 | 実Stripe通知はローカルではなく、Vercel/Supabase/Stripeテストモードを接続した公開環境で確認する。最新指示により確認先はProduction公開URLとする。 |

## 参照する設計箇所

- [要件定義書（正本）](../output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)：ORD-07、ORD-08、INV-02、INV-03、SEC-01、QLT-01。
- [基本設計書](../output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)：§9、§10、§12。
- [詳細設計書](../output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)／[編集原稿](../docs/detailed-design-review.md)：§6、§9、§11–13。
- [T31 Webhook実装](T31-stripe-webhook-state.md)、[T46 環境分離とCI/CD](T46-cicd-vercel-supabase-release.md)、[環境構築手順](../docs/environment-setup.md)、[AGENTS.md](../AGENTS.md)。

## 依存チケット・開始条件

- [T31 Stripe Webhookと決済状態](T31-stripe-webhook-state.md) がコード・自動テスト・レビュー・マージまで完了している。
- [T32 期限切れ照合と補償ジョブ](T32-payment-expiry-reconciliation.md) が完了している。
- [T46 GitHub Actions・Vercel・SupabaseのCI/CD](T46-cicd-vercel-supabase-release.md) の必須CIが通り、対象commitがProductionへ反映され、版管理済みマイグレーションと接続先を確認できる。
- **外部作業ゲート G-Stripe/G-Vercel/G-Supabase**：本人のアカウント作成・連携許可・認証、費用または公開範囲の判断が必要になる時点で具体的に確認する。既存権限で安全に戻せるWebhook登録・テスト設定・検証・片付けは自律的に行う。秘密の値は開示しない。

## 対象範囲

- Production公開環境 `ecsite-jade.vercel.app` の接続確認、StripeテストモードWebhookエンドポイントの登録・署名秘密の設定、実通知の受信とDB状態の検証。
- 検証用の架空商品・架空会員・架空配送先、テスト決済、イベント証拠と安全な片付け手順。
- 設定手順と検証結果の記録。実装不具合が見つかった場合はT49の範囲で修正できるものだけ対応し、設計変更は報告する。

## 実施内容

1. CI必須チェック成功とProduction deploymentのcommit SHAを確認する。ProductionのURL、Hosted Supabase接続先、適用migration/RLS状態、必要な環境変数の**登録有無・安全な形式の判定のみ**を確認し、秘密値は表示・出力しない。Stripe秘密鍵はテストモード用に限定し、`AUTH_BYPASS_ENABLED`を有効化しない。
2. Stripe Dashboardの**テストモード**で、Productionの正確な `https://ecsite-jade.vercel.app/api/webhooks/stripe` をWebhook宛先として登録し、T31が処理するイベント（`checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`checkout.session.expired`）を選ぶ。宛先固有の署名秘密をProduction server-only環境変数へ登録する。保護設定の変更はこのチケットの作業に含めない。
3. ProductionのCheckoutから、専用の匿名デモ会員と架空商品・架空配送先でテストセッションを作成する。Stripe側がtest modeであること、セッションが`livemode=false`であることを確認してからテストカードを使う。実住所・実メール・ライブ鍵・実課金・実発送は使わない。
4. 成功ケースでは、Stripe Dashboardの実DeliveryとVercel HTTP応答、同一注文のSupabase注文・決済試行・イベント・引当・在庫、注文結果/履歴画面を突合する。戻りURL到達だけでは`paid`にならず、署名済み成功通知の処理後にのみ確定することを確認する。失敗ケースでは成功扱いにならず、失敗・期限切れ時の案内と引当解放を確認する。
5. Stripe Dashboardから同一成功イベントを再送し、再送応答とDB状態を比較する。イベント重複が一度だけ記録・適用され、注文状態・在庫消費・引当が二重更新されないことを確認する。不正署名（欠落・不正値）は安全な合成HTTPリクエストで送り、400とDB不変を確認する。対象外イベント、逆順・遅延、異額・不一致、DB/API障害時の再試行は、実在するtest-modeイベントで可能な操作とCI/DB証拠に分けて記録する。手造りイベントやCI証拠をProduction実通知の証拠として扱わない。
6. ケースごとにUTC時刻、Production deployment SHA、ケース番号、Stripe test mode確認、event type/ID、Dashboard Delivery結果とHTTP status、マスク済み注文相関値、注文/決済状態、在庫・引当の前後差、画面結果を記録する。Webhook応答失敗の調査・再送手順とテストデータの安全な片付けも記録する。秘密、住所、電話、メール本文、Cookie、Checkout URL、request/response本文は証跡に含めない。

## 対象外

- ローカルDocker Desktop・Stripe CLIを前提にした環境構築。
- Stripeライブモード、実課金、実商品発送、Production上の実個人情報を使う試験。
- Vercel/Supabase/Stripeの有料プラン契約や、利用者に無断の公開範囲変更。
- T31の既存仕様を独断で変更すること。新たな設計矛盾は根拠・影響・選択肢を報告する。

## 受け入れ条件

- CI成功後に反映されたProduction URL `ecsite-jade.vercel.app` へStripe**テストモードの実通知**が届き、署名確認後に処理される。Stripe Dashboardの配信結果、Vercel応答、Supabaseの状態が同一テスト注文で対応づく。
- テスト決済成功・失敗を確認し、成功前に戻りURLだけで`paid`へ進まない。在庫の消費・解放、イベント重複排除がDB上で検証できる。
- 無効署名、再送、逆順、遅延、不一致、処理失敗の扱いを検証し、実通知で実施した範囲と合成/CIで実施した範囲を区別して記録する。
- テストはStripe test modeと架空データだけを使い、ライブ鍵・実個人情報・実課金・実発送を使わない。Hosted Supabaseは承認済み単一DB運用と切替手順に従い、同一DBへのPreview/ProductionジョブやWebhookの二重稼働を避ける。
- 証拠は日時、Production deployment SHA、環境識別子、イベントIDの必要最小限、結果と再現手順のみを残し、秘密・住所・電話・メール本文・Cookie・決済リンクを含めない。

## 必要なテスト

- ProductionでのテストCheckout成功・失敗と実Webhook配送、DB状態突合、戻りURLだけでは未確定の確認。
- Stripe Dashboard再送による同一イベントの重複、署名不正、対象外イベント、逆順・期限後成功、在庫競合・異額の安全な確認。実通知で再現できない条件はT31/T32のCI/DB証拠で補完し、Production実通知との区別を記録する。async決済イベントを実配送できない場合は未検証とする。
- Production環境変数・DB接続先・Webhook宛先・Cronの状態、RLS、秘密漏えい、失敗後復旧の確認。設定値は存在/形式の判定にとどめ、秘密値を表示しない。

## 完了条件

- 受け入れ条件を満たし、実Stripeテスト通知を伴う検証証拠と実施不能ケースのCI証拠をレビュー可能な形で記録した。
- 外部設定が未了、Production実通知未着、必要な状態突合が未確認、または実施できないイベントケースが未検証のまま残る場合は未完了とする。実施不能ケースは根拠と代替CI証拠を記録し、T49全体の完了条件を満たしたと誤表示しない。
- 変更点、テスト結果、PR/commit、未解決事項、外部設定・運用引継ぎを報告し、T47に結果を渡す。
