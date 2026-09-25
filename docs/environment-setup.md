# 自作PCパーツECサイト 環境構築・接続手順（レビュー版）

**版** 0.9 ／ **作成日** 2026年9月25日 ／ **状態** 手順のみ。外部アカウント・プロジェクト・秘密は未作成、接続未実施。  
実施時は`AGENTS.md`と`docs/implementation-plan.md`を併読する。画面名・サービス仕様は変更され得るため、実行直前に公式資料を確認する。

## 1. 環境の対応

| 環境 | Web | DB/Auth/Storage | 決済 | メール/SMS | 個人情報 |
| --- | --- | --- | --- | --- | --- |
| Local/Test | ローカルNext.js | ローカルSupabase CLI、テストデータ | Stripeテスト鍵／モック | ローカル捕捉、模擬SMS。所有端末SMS検証は別ゲート | 架空情報のみ |
| Preview | PRごとのVercel Preview | 専用Supabase Previewプロジェクト。Productionデータを複製しない | 分離したStripeテストデータ・Webhook | 許可宛先に限定したSMTP、模擬SMS | 架空情報のみ。外部閲覧を制限できる設定を検討 |
| Production | `main`からVercel Production、ポートフォリオ一般公開 | 専用Supabase Productionプロジェクト | Stripe**テスト鍵のみ** | 実メール送信、模擬SMS | 架空情報を推奨。自由入力可、30日削除 |

SupabaseのPRごとのBranchingは有料プランの可能性があるため採用前提にしない。Previewは固定の別プロジェクトを使い、並行PRのDB変更が競合する場合は適用順を調整する。PreviewへProductionのDBダンプ、利用者メール、住所、注文をコピーしない。

## 2. GitHubリポジトリの初期手順（T01、T05、T46）

1. 利用者がGitHubでリポジトリの所有者・公開範囲を選び、作成・認証する。既存の`docs/`、`output/pdf/`、`AGENTS.md`を保全してローカルGitを初期化し、`main`へ最初のコミットを作る。外部公開範囲の決定は利用者の操作で行う。
2. `.gitignore`で`.env.local`、`.env.*.local`、`.vercel/`、`.next/`、`node_modules/`、Supabase CLIの`.temp/`、テスト結果を除外する。`.env.example`に**変数名とダミー値のみ**置く。
3. PRのチェック項目をlint、TypeScript、Vitest、OpenAPI、DB/RLS、Playwright、ビルドに増やす。`main`への直接変更を制限し、利用可能なGitHubルールで必須チェックとレビューを設定する。未信頼PRに外部秘密を渡さず、`pull_request_target`でPRコードを秘密付き実行しない。
4. GitHub Actionsの役割は検証と、承認されたDBマイグレーション適用ジョブに限定する。Vercel Git連携に任せるWebデプロイをActionsから二重に起動しない。

**利用者に提示する作業**：リポジトリ作成、所有者・公開範囲の選択、必要なGitHub/Vercel連携認証。実施前に、公開されるファイルと秘密を含めないことを確認する。

## 3. Supabaseの準備（T06–T11、T17、T46）

1. ローカル開発はDocker互換ランタイムとSupabase CLIを用意する。実装時に`supabase init`、`supabase start`でローカル環境を開始し、`supabase/migrations/`と`supabase/seed.sql`をGitで管理する。ローカルスタックは外部公開しない。
2. 利用者が**Preview用とProduction用の別Supabaseプロジェクト**を作成し、リージョン・費用を確認する。Project Ref、Project URL、公開可能鍵、サーバー専用秘密鍵、DB接続情報を環境別に保管する。具体的な鍵の名称は実際のSupabase画面に合わせて記録する。
3. AuthのSite URLとRedirect URLsを環境別に設定する。Productionは固定の公開URL、PreviewはVercel Preview URLの許可パターン、Localはlocalhostに限定する。許可パターンは所属Vercelチーム／アカウントのドメインに絞り、無関係な外部ドメインへ広げない。
4. Google Provider、Send Email Hook、Storage、Cronは対応チケットで追加する。RLSは全表をデフォルト拒否から開始し、公開商品と本人所有データの必要操作だけ許可する。管理者権限は本人編集不可の表で管理する。
5. SMTP秘密を管理画面から変更する設計に合わせ、Supabase Vault等の保護領域の利用可否と費用をT20/T41で検証する。利用できなければ、同等の秘密保護と管理変更が両立する代案を提示し、設計変更を要するなら確認する。

### DBマイグレーションの適用手順

1. LUNAが`supabase migration new <name>`で追加し、SQL・制約・RLS・索引・ロールバック／復旧方針をPRに記載する。リモートDBのダッシュボードでスキーマを直接編集しない。
2. ローカルで`supabase db reset`を実行し、seedとDB/RLSテストを通す。**`db reset --linked`をProductionに使わない。**
3. Preview用Project Refを明示して`supabase link --project-ref <preview-ref>`、差分確認後に`supabase db push`を一人／一ジョブずつ実行する。PreviewでWeb・DBの統合試験を行う。
4. Productionでは後方互換な「追加→補完→切替→旧要素削除」の順に変更する。リリース前に対象Project Refとバックアップ・復旧方法を再確認し、承認されたマイグレーションをProductionへ**Web切替前**に一件ずつ適用する。初期版は手動の監督付き適用を採用し、CIによる無人自動適用は運用が安定してから別途検討する。
5. マイグレーション履歴と実DBを確認し、`main`反映でVercel Productionをデプロイする。失敗時はアプリを直前の互換版へ戻す。破壊的SQLの逆実行でデータを失わないよう、先に互換的な復旧手順を用意する。

## 4. Google OAuth、メール、SMS（T18–T20、T41）

**メール・パスワード認証（T17）**：Next.js SSRは`NEXT_PUBLIC_SUPABASE_URL`と`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`を使い、`@supabase/ssr`でHTTP-only Cookieのセッションを更新する。開発時はAuth Site URLとRedirect URLsをローカルのWeb URLへ限定する。確認メールはSupabase Authから実送信されるため、Hosted Supabase/SMTPの接続を確認する前に公開環境へ接続済みと扱わない。`AUTH_BYPASS_ENABLED=true`は`NODE_ENV=development|test`のみ許可し、Productionでは起動・ビルドを失敗させる。ローカルE2EはSupabase CLIのメール受信箱を使い、外部メールを送信しない。

**Google（T18）**：利用者がGoogle Auth PlatformでOAuth consent screenを設定し、Web application型OAuth clientを環境ごとに作成する。Google側のAuthorized JavaScript originsにはサイトoriginのみ（schemeとhost。pathなし）を登録し、Authorized redirect URIsにはSupabase DashboardのGoogle Providerに表示されるcallback URLを登録する。Hosted Supabaseの場合は`https://<project-ref>.supabase.co/auth/v1/callback`、Supabase CLI localの場合は`http://127.0.0.1:54321/auth/v1/callback`。Supabase DashboardのAuthentication → Sign In / Providers → GoogleでClient IDとClient Secretを設定し、callback URLがGoogle側の登録値と一致することを確認する。

Google Authorized JavaScript originsの例はローカルCIが`http://127.0.0.1:4173`、開発サーバーが`http://localhost:3000`、Preview/Productionがそれぞれ`https://<preview-host>`と`https://<public-host>`。Google側には実際に使う各originを登録する。

Supabase AuthのSite URLには当該環境の`NEXT_PUBLIC_SITE_URL`を設定し、Redirect URLsへ同じoriginの`/auth/callback`を追加する。今回のローカルCI URLは`http://127.0.0.1:4173/auth/callback`、開発サーバー標準URLは`http://localhost:3000/auth/callback`。Preview/Productionではそれぞれ`https://<preview-host>/auth/callback`と`https://<public-host>/auth/callback`を登録する。ワイルドカードは使わず、実際に使用するホストだけを許可する。Google Client SecretはSupabase Provider設定にのみ保存し、Next.js環境変数やアプリDBには置かない。アプリ要求スコープは`openid email profile`で、配送先は本サイト内で入力する。

**利用者の設定・認証が必要**：Google Cloudのプロジェクト/OAuthクライアント作成とSupabase Provider設定は利用者本人が行う。OAuthを有効にするためのGoogleアカウントが必要で、料金はGoogle/Supabaseの契約プランと利用条件に従う。設定後、Preview環境でGoogle登録・ログイン、キャンセル・拒否時の回復、同一サイト内の戻り先を確認する。設定前はローカル模擬テストのみ実施し、外部接続済みとは扱わない。

**メール**：利用者が利用するSMTP送信先・送信元ドメイン・認証情報を決める。Supabase Auth Send Email Hookの署名秘密をVercelの環境別秘密設定へ置き、Vercelの送信処理から管理設定のSMTPへ接続する。Previewは許可宛先だけに送る。Productionは実メールを送るが、秘密は画面に再表示しない。設定前に利用料金・送信制限・ドメイン認証要件を確認する。

**SMS**：公開Productionは`mock`固定で、電話番号をSMS送信用に収集しない。6桁コードを当該フローのデモ通知で示し、照合は省略しない。所有端末での実SMS試験はDevelopment/Testの別設定でのみ可能にする。ゲートウェイの選定・有料利用は利用者承認後。実端末検証が終わるまで「検証済み」とポートフォリオに記載しない。

## 5. Stripeテスト決済（T30–T32）

利用者がStripeアカウントと**テストモード**の鍵を用意する。環境別に`sk_test_*`とWebhook署名秘密を設定し、`sk_live_*`と`pk_live_*`はビルド・起動・公開前検査で拒否する。Checkoutはホスト型。カード情報をサイト側で保存しない。Webhook URLはPreviewとProductionで分け、エンドポイント秘密も共有しない。Stripeには注文ID・試行IDと確定金額のみ送り、氏名・住所・メールをメタデータに含めない。ローカルはStripe CLIまたはテストイベントを使ってWebhookを試し、署名不正・重複・逆順・再試行を検証する。

**利用者に提示する作業**：テストアカウント・テスト鍵・Webhookエンドポイントの作成／認証。ライブモードの有効化は求めない。費用が発生する外部機能が必要なら先に見積を示す。

## 6. VercelとGitHubの接続（T46–T47）

1. 利用者がVercelプロジェクトを作成し、対象GitHubリポジトリへのアクセスを許可する。Production Branchは`main`に設定する。PRでPreview、main反映でProductionが生成される構成を使う。
2. VercelのDevelopment/Preview/Productionごとに環境変数を別値で設定する。`NEXT_PUBLIC_*`だけがブラウザに露出し得る。秘密鍵をその接頭辞に置かない。変数変更後は対象環境を再デプロイして反映を確認する。
3. PreviewはPreview用Supabase・StripeテストWebhook・制限付きSMTPを指す。ProductionはProduction用Supabase・Stripe**テスト**Webhook・本番用SMTPを指す。Preview URLが複数できる場合はSupabase AuthのRedirect URL許可範囲をチームドメインへ限定する。
4. 公開前に一般閲覧者が実際の購入導線を操作できること、管理画面を非管理者が使えないこと、30日削除・監視・公式料金リンクを確認する。公開URLやドメインの最終選択は利用者が行う。

## 7. 環境変数・秘密の配置表

名称は実装チケットで`.env.example`と一致させる。以下は**値ではなく変数名の設計案**。秘密をMarkdown、PR、ログに貼らない。

| 変数／設定 | Local | Preview | Production | 公開可否・用途 |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | localhost | Preview URL | 公開URL | 公開可。OAuth・メール戻り先は許可URLと照合 |
| `NEXT_PUBLIC_SUPABASE_URL` | Local URL | Preview project | Production project | 公開可 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Local | Preview | Production | 公開可。ただしRLS必須。使用するSupabase鍵の名称に合わせる |
| `SUPABASE_SERVICE_ROLE_KEY` | Local | Preview専用 | Production専用 | サーバーのみ。RLSを迂回するため用途限定 |
| `STRIPE_SECRET_KEY` | `sk_test_*` | `sk_test_*` | `sk_test_*` | サーバーのみ。ライブ鍵拒否 |
| `STRIPE_WEBHOOK_SECRET` | Local専用 | Preview専用 | Production専用 | サーバーのみ、相互に異なる |
| `AUTH_EMAIL_HOOK_SECRET` | Local専用 | Preview専用 | Production専用 | サーバーのみ。Supabase Hook署名検証 |
| `INTERNAL_JOB_SECRET` | Local専用 | Preview専用 | Production専用 | サーバーのみ。Cron→Vercel内部API |
| `ANON_CART_SIGNING_KEY` | Local専用 | Preview専用 | Production専用 | サーバーのみ。匿名カートCookie |
| `SMS_DELIVERY_MODE` | `mock`／試験時のみ`real` | `mock` | `mock`固定 | 公開デモの実SMSを防ぐ |
| `AUTH_BYPASS_ENABLED` | 必要時のみ`true` | `false` | `false`固定 | Productionで`true`なら起動拒否 |
| `SMTP_ALLOWED_RECIPIENTS` | テスト宛先 | 許可宛先のみ | 運用方針に従う | 宛先制限。SMTP資格情報はVault等の保護領域 |
| Google Client Secret | Local Provider | Preview Supabase | Production Supabase | Supabase側のProvider設定。アプリDB/ブラウザに保存しない |
| Supabase CLIのAccess Token/DB資格情報 | 必要時のみ | 適用作業のみ | 承認された適用作業のみ | GitHub環境秘密または利用者の安全なローカル保管。PR検証に渡さない |

## 8. 外部サービスの利用者作業ゲート

| ゲート | 発生時点 | 利用者に提示する具体的な作業 | 未完了時にできること |
| --- | --- | --- | --- |
| G-GitHub | T01/T05/T46 | リポジトリ作成、所有者・公開範囲・連携許可、利用可能な保護ルールの確認 | ローカルGitとCI定義の作成 |
| G-Supabase | T17/T32/T46 | Preview/Production別プロジェクト作成、リージョン・費用確認、鍵とProject Refの安全な登録 | ローカルDB、RLS、マイグレーション試験 |
| G-Google | T18 | OAuthクライアント作成、環境別origin/callback URL登録、Supabase Provider設定 | callbackコードと模擬試験 |
| G-SMTP | T20/T41 | SMTP送信先・送信元ドメイン・認証、料金と送信制限確認 | モック送信・Hook署名・UI試験 |
| G-Stripe | T30–T32 | テストアカウント、テスト鍵、環境別Webhook登録 | SDKモックと状態機械試験 |
| G-Vercel | T46 | プロジェクト作成、GitHub連携、環境変数、Preview/Production設定 | ローカルビルドとActions検証 |
| G-Publication | T47 | 公開URL/ドメイン・公開範囲の最終選択 | Previewで最終スモーク |

有料プラン、課金、契約、本人認証が必要になったら、LUNAはその時点で「何を作るか／なぜ必要か／費用見込み／無料代替／設定後の確認方法」を提示する。利用者の操作・承認が届くまで外部接続の完了を主張しない。

## 9. リリース前の確認

- PreviewとProductionでSupabase Project Ref、Stripeテスト鍵・Webhook秘密、SMTP送信先、Hook秘密、Cron秘密が異なる。
- `main`の必須CIが成功し、Productionに認証省略とライブStripe鍵が存在しない。
- DBマイグレーション履歴・RLS・Storage・バックアップ復元を確認し、個人情報を含むバックアップにも30日方針を適用できる。
- メール確認・Google・模擬SMS・パスワード再設定、商品探索、構成、不一致でも購入、在庫競合、Stripe成功/失敗、注文履歴、管理者拒否が通る。
- サイトに実販売・実課金・実発送なし、架空住所の推奨、30日削除、ヤマト運輸の公式情報リンクを表示する。
- 障害時の連絡先、Webhook滞留、在庫引当期限、メール失敗、削除ジョブ失敗を監視できる。

## 10. 公式資料

- [Vercel Git連携](https://vercel.com/docs/git)、[環境変数](https://vercel.com/docs/environment-variables)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli-workflows)、[DBマイグレーション](https://supabase.com/docs/guides/deployment/database-migrations)、[環境管理](https://supabase.com/docs/guides/deployment/managing-environments)、[Auth Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)、[Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
- [GitHub Actions Deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)
- [Stripe Checkoutテスト](https://docs.stripe.com/testing)、[Webhook](https://docs.stripe.com/webhooks)
