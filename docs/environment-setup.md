# 自作PCパーツECサイト 環境構築・接続手順（レビュー版）

**公開MVPの現行環境方針**：[2026-09-28に承認された単一Hosted DB運用](mvp-hosting-decision-2026-09-28.md)を優先する。以下の接続・migration手順は今回の1 Hosted Supabase逐次運用に合わせる。別Supabaseプロジェクトを作る手順ではない。

**版** 0.9 ／ **作成日** 2026年9月25日 ／ **状態** 初期手順を保持し、公開MVPの接続準備・監査結果を追記。実際のHosted設定は環境側で別途確認する。
実施時は`AGENTS.md`と`docs/implementation-plan.md`を併読する。画面名・サービス仕様は変更され得るため、実行直前に公式資料を確認する。

**公開MVPの最新方針**：[mvp-release-plan.md](mvp-release-plan.md)を先に適用する。一般閲覧者はT50/T51の個別匿名デモ会員と固定架空住所を利用する。単一Hosted SupabaseのAuthで匿名サインインを有効化し、レート制限とRLSを検証する。公開MVPに一般利用者向けGoogle OAuth・SMTP・実SMSは不要。以下のメール/Google手順は公開後の全件計画として残し、デモ会員へ実住所・実メール入力を開放しない。

## T46 接続監査スナップショット（2026-09-29）

- Hosted読み取り結果は[T46監査記録](t46-hosted-audit-results.md)を参照。25 migrationsがrepoと一致し、匿名Auth公開設定が有効、匿名RLSでpublished商品18件を確認。T22/T32 Cron関連Vault secret名5件は0件で、外部ジョブ実行は未確認。
- Vercel `ecsite`の固定Preview deploymentはReady、SHA `ac7c42696c935700b36b7d25263ac605ea8cd30a`。Preview変数8件（`NEXT_PUBLIC_SITE_URL`を含む）はすべて`codex/mvp-demo-preview`限定で、これらのgeneric Preview entryは0件。Productionには最新main基準のReady deploymentがあるが、Production environment variablesは未登録との監査結果で、MVPの稼働確認済みではない。
- Preview ProtectionはSSO redirectを確認。Protection方式は利用者判断待ちで、設定を変更しない。
- Vercel Preview environmentでT49用の`STRIPE_WEBHOOK_SECRET`、`INTERNAL_JOB_SECRET`、`T22_INTERNAL_JOB_SECRET`を確認できていない。固定PreviewのSSO越しアプリ疎通、Hosted商品一覧/匿名Auth動作、T49の鍵とStripe Webhook接続は未確認。秘密値はこの文書に記録しない。
- GitHub mainは2026-09-29に保護設定を確認済み。active ruleset `main protection`でPR経由を必須とし、required checks `Quality gates`と`Catalog UI browser tests`を設定。required approvalsは0。公開APIで`protected: true`と規則を再確認した。

## 1. 環境の対応

| 環境 | Web | DB/Auth/Storage | 決済 | メール/SMS | 個人情報 |
| --- | --- | --- | --- | --- | --- |
| Local/Test | ローカルNext.js | ローカルSupabase CLI、テストデータ | Stripeテスト鍵／モック | ローカル捕捉、模擬SMS。所有端末SMS検証は別ゲート | 架空情報のみ |
| 固定Hosted検証Preview | Vercel `codex/mvp-demo-preview`の固定Preview | 単一Hosted Supabaseを検証専用で使用 | Stripeテスト鍵と固定PreviewのWebhook endpoint | 公開MVPではSMTP/実SMSなし、模擬SMSのみ | T51で定める架空情報のみ |
| 通常のPR Preview | PRごとのVercel Preview | Hosted Supabaseへ接続しない。DB/RLSはActionsのローカルSupabase | Hosted Stripe secretを渡さない | 外部送信しない | 架空テストデータのみ |
| 提示用Production（切替後） | `main`からVercel Production | 同じHosted Supabaseを提示用として順次利用 | Stripe**テスト鍵のみ**。Webhook先・署名秘密は切替時に設定 | 公開MVPではSMTP/実SMSなし、模擬SMSのみ | T51で定める架空情報のみ、30日削除 |

PreviewとProductionを同じHosted DBへ同時接続しない。検証中は固定Previewだけを接続し、ProductionからのDB/Auth/Storageアクセスを無効に保つ。公開用へ切り替える前に未完了注文、決済照合、Webhook再試行、Cron接続先を確認し、PreviewからHosted資格情報を外してからProductionへ接続する。切替後に作成する通常のPR PreviewへHosted DB・サービスロール・Stripe webhook・内部Cron資格情報を渡さない。SupabaseのPRごとのBranchingは採用しない。DBダンプ、利用者メール、住所、注文を環境間でコピーしない。

## 2. GitHubリポジトリの初期手順（T01、T05、T46）

1. 利用者がGitHubでリポジトリの所有者・公開範囲を選び、作成・認証する。既存の`docs/`、`output/pdf/`、`AGENTS.md`を保全してローカルGitを初期化し、`main`へ最初のコミットを作る。外部公開範囲の決定は利用者の操作で行う。
2. `.gitignore`で`.env.local`、`.env.*.local`、`.vercel/`、`.next/`、`node_modules/`、Supabase CLIの`.temp/`、テスト結果を除外する。`.env.example`に**変数名とダミー値のみ**置く。
3. 既存PR CIの成功を確認し、`main`への直接変更を制限してCI必須チェックとレビューを設定する。2026-09-29にactive ruleset `main protection`、PR必須、required checks `Quality gates`と`Catalog UI browser tests`を確認済み。required approvalsは0。未信頼PRに外部秘密を渡さず、`pull_request_target`でPRコードを秘密付き実行しない。
4. GitHub Actionsの役割は検証と、承認されたDBマイグレーション適用ジョブに限定する。Vercel Git連携に任せるWebデプロイをActionsから二重に起動しない。

**利用者に提示する作業**：リポジトリ作成、所有者・公開範囲の選択、必要なGitHub/Vercel連携認証。実施前に、公開されるファイルと秘密を含めないことを確認する。

## 3. Supabaseの準備（T06–T11、T17、T46）

1. ローカル開発はDocker互換ランタイムとSupabase CLIを用意する。実装時に`supabase init`、`supabase start`でローカル環境を開始し、`supabase/migrations/`と`supabase/seed.sql`をGitで管理する。ローカルスタックは外部公開しない。
2. 公開MVPでは新規のPreview/Production別Supabaseプロジェクトを作らない。承認済み単一Hosted projectを検証中は固定Preview専用とし、Project Ref、URL、公開鍵、サーバー秘密、DB接続情報は安全な環境設定とパスワード管理に置く。
3. 検証中のAuth Site URLは固定Preview URL、Redirect URLsは必要な固定Previewとlocalhostに限定する。提示用への切替時にSite URLを公開URLへ変更し、許可リストも必要なURLへ更新する。PreviewとProductionを同時運用するためのワイルドカードを追加しない。
4. Google Provider、Send Email Hook、Storage、Cronは対応チケットで追加する。RLSは全表をデフォルト拒否から開始し、公開商品と本人所有データの必要操作だけ許可する。管理者権限は本人編集不可の表で管理する。
5. SMTP秘密を管理画面から変更する設計に合わせ、Supabase Vault等の保護領域の利用可否と費用をT20/T41で検証する。利用できなければ、同等の秘密保護と管理変更が両立する代案を提示し、設計変更を要するなら確認する。

### DBマイグレーションの適用手順

1. LUNAが`supabase migration new <name>`で追加し、SQL・制約・RLS・索引・ロールバック／復旧方針をPRに記載する。リモートDBのダッシュボードでスキーマを直接編集しない。
2. ローカルで`supabase db reset`を実行し、seedとDB/RLSテストを通す。**`db reset --linked`をProductionに使わない。**
3. 承認済みHosted Project Refを明示して`supabase link --project-ref <hosted-ref>`し、差分と対象Project Refを別担当者も確認してから、承認されたmigrationだけを監督付きで適用する。Hosted環境の適用をPR/Actionsへ接続しない。
4. Hosted projectは検証期間中は固定Previewで使う。T49後、Production切替前に決済中注文、Webhook再試行、T32/T22 Cron接続先、migration履歴、バックアップ・復旧方法を照合し、PreviewからHosted接続を外す。その後同じprojectを提示用へ切り替える。migration適用後のDBを複製・再作成しない。
5. マイグレーション履歴と実DBを確認し、切替後に`main`からVercel Productionをデプロイする。失敗時はアプリを直前の互換版へ戻す。破壊的SQLの逆実行でデータを失わないよう、先に互換的な復旧手順を用意する。Productionに対して`db reset --linked`は使わない。

## 4. Google OAuth、メール、SMS（T18–T20、T41）

**メール・パスワード認証（T17）**：Next.js SSRは`NEXT_PUBLIC_SUPABASE_URL`と`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`を使い、`@supabase/ssr`でHTTP-only Cookieのセッションを更新する。開発時はAuth Site URLとRedirect URLsをローカルのWeb URLへ限定する。確認メールはSupabase Authから実送信されるため、Hosted Supabase/SMTPの接続を確認する前に公開環境へ接続済みと扱わない。`AUTH_BYPASS_ENABLED=true`は`NODE_ENV=development|test`のみ許可し、Productionでは起動・ビルドを失敗させる。ローカルE2EはSupabase CLIのメール受信箱を使い、外部メールを送信しない。

**Google**：利用者がGoogle Auth PlatformでWeb OAuthクライアントを環境ごとに作成し、許可するJavaScript originとSupabase Dashboardに表示されるcallback URLを登録する。GoogleのClient ID/Secretを対応するSupabase Provider設定へ入れる。アプリからの戻り先はSupabaseのRedirect URL許可リストに合わせる。スコープは`openid email profile`に限定し、配送先は本サイトで入力する。設定・認証が必要になった時点で、具体的なURL一覧をLUNAが提示する。

**メール**：利用者が利用するSMTP送信先・送信元ドメイン・認証情報を決める。Supabase Auth Send Email Hookの署名秘密をVercelの環境別秘密設定へ置き、Vercelの送信処理から管理設定のSMTPへ接続する。Previewは許可宛先だけに送る。Productionは実メールを送るが、秘密は画面に再表示しない。設定前に利用料金・送信制限・ドメイン認証要件を確認する。

**SMS**：公開Productionは`mock`固定で、電話番号をSMS送信用に収集しない。6桁コードを当該フローのデモ通知で示し、照合は省略しない。所有端末での実SMS試験はDevelopment/Testの別設定でのみ可能にする。ゲートウェイの選定・有料利用は利用者承認後。実端末検証が終わるまで「検証済み」とポートフォリオに記載しない。

## 5. Stripeテスト決済（T30–T32、T49）

利用者がStripeアカウントと**テストモード**の鍵を用意する。`sk_live_*`と`pk_live_*`はビルド・起動・公開前検査で拒否する。Checkoutはホスト型。カード情報をサイト側で保存しない。検証期間中は固定PreviewのWebhook endpointと固有の`STRIPE_WEBHOOK_SECRET`を使う。Hosted SupabaseをProductionへ切り替える際は、古いPreview endpointからの未完了イベントを照合してから受信先と署名秘密を切り替え、2環境が同じDBへ並行処理しない。Stripeには注文ID・試行IDと確定金額のみ送り、氏名・住所・メールをメタデータに含めない。T31では署名付きテストイベント・DB統合テストで署名不正、重複、逆順、再試行を検証する。**実Stripe通知はT49で固定Previewから単一Hosted Supabaseへ一時接続して確認する。ローカルDocker Desktop・Stripe CLIは前提にしない。**

**利用者に提示する作業**：T49開始時に、Vercel/Supabase/Stripeの本人による作成・連携許可・認証、費用または公開範囲の判断が必要な部分だけを具体的に提示する。既存権限で安全に戻せるWebhook宛先登録、環境別秘密設定、テストと片付けは自律的に進める。ライブモードの有効化は求めない。費用が発生する外部機能が必要なら先に見積を示す。秘密の値はチャット・Gitへ貼らず環境別の秘密設定に保存する。

## 6. VercelとGitHubの接続（T46、T49、T47）

1. Vercel `ecsite`はGitHub `qtaro-dev/ECsite`へ接続済み。Production Branchは`main`とし、Vercel Git連携がPR Previewとmain Productionを作る。Actionsから二重デプロイしない。GitHub mainはactive ruleset `main protection`でPRを必須にし、required checks `Quality gates`と`Catalog UI browser tests`を設定済み。required approvalsは0である。
2. Hosted資格情報は固定Previewの検証branchだけに必要最小限設定し、Preview環境全体のSecretとして他PRへ継承されないことを確認する。未信頼PRのPreviewには`SUPABASE_SERVICE_ROLE_KEY`、`STRIPE_WEBHOOK_SECRET`、`INTERNAL_JOB_SECRET`、`T22_INTERNAL_JOB_SECRET`を渡さない。`NEXT_PUBLIC_*`のみ公開可能だが、Supabaseの公開URL/鍵もHosted DBへのアクセス権を持つので通常PR Previewには渡さず、ActionsのローカルSupabaseを使う。Production環境変数は提示切替時に初めて設定する。秘密鍵を`NEXT_PUBLIC_*`へ置かない。
3. 検証中は固定PreviewのみHosted Supabase・StripeテストWebhookを使い、Productionから同じHosted DBへの接続を止める。切替時はPreview接続を外してからProductionへ同じSupabase projectを設定する。Preview Protection方式と自動Cronからの接続要件は利用者判断後に確認し、SSO設定を独断で変更しない。SMTPは公開MVPでは不要。Preview URLが複数できてもAuth Redirect URLを限定する。
4. 公開前に一般閲覧者が実際の購入導線を操作できること、管理画面を非管理者が使えないこと、30日削除・監視・公式料金リンクを確認する。公開URLやドメインの最終選択は利用者が行う。

## 7. 環境変数・秘密の配置表

名称は実装チケットで`.env.example`と一致させる。以下は**値ではなく変数名の設計案**。秘密をMarkdown、PR、ログに貼らない。

| 変数／設定 | Local | 固定Hosted検証Preview | 通常のPR Preview | 提示用Production（切替後） | 公開可否・用途 |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | localhost | 固定Preview URL | PR固有URL（Hostedを使わない） | 公開URL | 公開可。T49で固定Preview値を照合し、切替時に更新 |
| `NEXT_PUBLIC_SUPABASE_URL` | Local URL | 単一Hosted project | Local CI以外は設定しない | 切替後に同じHosted project | URL自体は公開可だが接続先環境を限定 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Local | Hosted project | 設定しない | 切替後に同じHosted project | 公開鍵。RLSを必須とし通常PRへHosted値を渡さない |
| `SUPABASE_SERVICE_ROLE_KEY` | Local | Hosted検証用 | 設定しない | 切替後に同じHosted project | サーバー専用。RLSを迂回するため用途を限定 |
| `ADMIN_SETUP_CODE` | 32バイト以上の乱数 | 初回セットアップを行う環境に一時設定 | 設定しない | 初回セットアップを行う場合のみ一時設定 | サーバー専用。初回管理者作成後に削除し再デプロイ |
| `STRIPE_SECRET_KEY` | テスト鍵 | Stripeテストモード | 設定しない | Stripeテストモード | サーバー専用。ライブ鍵拒否 |
| `STRIPE_WEBHOOK_SECRET` | Local専用 | 固定Preview endpoint用 | 設定しない | 切替後のendpoint用 | サーバー専用。T49で実通知確認し、endpoint切替時に再設定 |
| `AUTH_EMAIL_HOOK_SECRET` | Local専用 | 公開MVPでは不要 | 設定しない | 公開MVPでは不要 | SMTP確認メールは公開後の範囲 |
| `INTERNAL_JOB_SECRET` | Local専用 | T32 Cron用 | 設定しない | Hosted切替後に設定 | サーバー専用。Cron→照合API署名。専用値 |
| `T22_INTERNAL_JOB_SECRET` | Local専用 | T22 Cron用 | 設定しない | Hosted切替後に設定 | サーバー専用。匿名デモ削除Cron署名。32バイト以上の乱数 |
| `ANON_CART_SIGNING_KEY` | Local専用 | 固定Preview専用 | 設定しない | 切替後に設定 | サーバー専用。匿名カートCookie署名 |
| `SMS_DELIVERY_MODE` | `mock`／所有端末テストのみ`real` | `mock` | `mock` | `mock`固定 | 公開デモの実SMSを防ぐ |
| `AUTH_BYPASS_ENABLED` | 必要時のみ`true` | `false` | `false` | `false`固定 | Productionで`true`なら起動拒否 |
| `SMTP_ALLOWED_RECIPIENTS` | テスト宛先 | 公開MVPでは不要 | 設定しない | 公開MVPでは不要 | SMTPは公開後。資格情報はVault等の保護領域 |
| Google Client Secret | Local Provider | 公開MVPでは不要 | 設定しない | 公開MVPでは不要 | 一般向けOAuthは公開後 |
| Supabase CLIのAccess Token/DB資格情報 | 必要時のみ | migration適用時のみ手元で使用 | GitHub/Vercel Previewへ渡さない | 承認された切替・適用時のみ | GitHub Actions secretにしてPRコードへ渡さない |

VercelのPreview environment variablesが特定branch限定でない場合、そこへHosted値を置くとPR Previewに継承される可能性がある。固定検証branch以外へのSecretスコープを外し、PR Preview側からHosted SupabaseのURL/公開鍵も含めて接続情報を取り除く。`.env.example`は変数名と空欄だけを置き、秘密値を記入しない。

## 8. 外部サービスの利用者作業ゲート

| ゲート | 発生時点 | 利用者に提示する具体的な作業 | 未完了時にできること |
| --- | --- | --- | --- |
| G-GitHub | T01/T05/T46 | mainのactive ruleset `main protection`、PR必須、required checks `Quality gates`/`Catalog UI browser tests`を設定・公開APIで確認済み。required approvalsは0 | 設定確認済み。PR必須CIの継続監視 |
| G-Supabase | T17/T32/T46/T49 | 既存の単一Hosted projectを検証から提示へ逐次切替。Project Ref・migration履歴・匿名Auth・費用/保持を確認し、鍵は環境設定へ登録 | CIのローカルSupabaseでDB/RLS試験。Hosted T49実通知DB照合は未完了 |
| G-Google | T18 | OAuthクライアント作成、環境別origin/callback URL登録、Supabase Provider設定 | callbackコードと模擬試験 |
| G-SMTP | T20/T41 | SMTP送信先・送信元ドメイン・認証、料金と送信制限確認 | モック送信・Hook署名・UI試験 |
| G-Stripe | T30–T32/T49 | テストアカウント・テスト鍵。T49で固定Preview endpoint登録、Webhook署名秘密を安全なPreview scopeへ設定 | T31/T32の署名付きイベント・状態機械・DB統合試験。実通知確認はT49まで未完了 |
| G-Vercel | T46/T49 | 既存projectのGit連携と8変数の固定Preview branch scopeを確認済み。新deploymentへの反映、Hosted疎通、Protection付きアクセス、T49鍵と実通知は未確認。Protection方式は利用者判断後に限り変更 | ローカルビルドとActions検証。PreviewのHosted接続・実通知は未完了 |
| G-Publication | T47 | 公開URL/ドメイン・公開範囲の最終選択 | Previewで最終スモーク |

有料プラン、課金、契約、本人認証が必要になったら、LUNAはその時点で「何を作るか／なぜ必要か／費用見込み／無料代替／設定後の確認方法」を提示する。利用者の操作・承認が届くまで外部接続の完了を主張しない。

### T32 期限切れ決済のCron接続

T32マイグレーションは5分間隔の`pg_cron`ジョブ`t32-payment-reconciliation`を登録する。`pg_net`がHTTPS POSTをVercelへ送る。単一Hosted SupabaseのVaultへ`t32_reconciliation_url`（運用中の固定Previewまたは切替後Production URLに`/api/internal/reconcile-payments`を付けた値）と`t32_internal_job_secret`（そのVercel環境の`INTERNAL_JOB_SECRET`と同じ専用32バイト以上の乱数）を登録する。検証PreviewとProductionへ同時に送信先を設定しない。空欄ならジョブは安全に何も送らず、片方だけ／不正な値はCron実行エラーになる。Stripe秘密鍵はVercelだけに置き、Supabase VaultやCronに入れない。APIは3件以内を並列処理し、Function最大実行時間を60秒に設定するため、T46では固定Previewの実行上限を確認する。提示用切替後にProductionの実行上限を確認する。

接続時はSupabase Cron画面または`cron.job`でジョブ登録を確認し、`cron.job_run_details`の実行成功とVercel側で署名付き`POST`が処理されることを確認する。期限切れSessionの実照合はStripeのテスト環境で行い、その接続確認はT49のPreview受け入れに含める。Vault値・HTTP署名・秘密鍵をPRやログへ貼らない。

### T22 匿名デモ会員の30日削除

T22マイグレーションは15分間隔の`pg_cron`ジョブ`t22-demo-retention`を登録する。単一Hosted DBの検証中は、Supabase Vaultへ`t22_retention_url`（固定Preview URLに`/api/internal/delete-expired-demos`を付けた値）と`t22_internal_job_secret`（Vercel検証環境の`T22_INTERNAL_JOB_SECRET`と同一の専用32バイト以上の乱数）を登録する。Preview deployment protectionで保護されたVercel Previewへ送る場合は、Vercel Project Settingsで発行した専用のAutomation Protection Bypass secretも`t22_vercel_bypass_secret`としてVaultへ登録する。pg_netはその値を`x-vercel-protection-bypass` HTTPヘッダーにのみ設定する。Vercel公式が推奨するヘッダー方式を使い、URLへ秘密を埋め込まない。現在のProtection方式はSSOで、方式変更は利用者判断待ちのため、automation bypass設定を先行変更せず、許可された接続方法が決まるまでHosted Cron接続を成功扱いにしない。ローカルや保護されていない接続先では省略でき、未設定時はVercel用ヘッダーを送らない。提示用へ切り替える際は未完了ジョブ・注文・Webhookを照合し、URLと各秘密を同時に切り替える。URLとHMAC秘密が両方未設定なら送信せず、片方だけ／不正な値はCron実行エラーとする。Stripeテスト鍵とSupabaseサービスロール鍵はVercelサーバーにだけ置く。

`public.demo_retention_queue`はサービスロールだけが読める。`last_error_code`は個人情報を含まない固定値で、`payment_pending`はT32決済照合を待つ。`stripe_unavailable`、`auth_unavailable`、`db_unavailable`、`unexpected`は外部・DB障害として調査する。Cron成功だけで削除成功とせず、署名付き内部APIの`checked/deleted/deferred`件数とキューの滞留・最古`requested_at`、`cron.job_run_details`の失敗を監視する。未解決決済または有効在庫引当が残る間はAuthユーザーを消さず、15分後に再試行する。30日を超えて保留が続く場合は公開条件未達として原因を調べる。秘密や利用者IDをログへ出さない。

本人削除は匿名デモAuthの有効セッションをサーバーで再確認し、同一Originと明示確認文言を要求する。通常会員の再認証付き削除とT34通知ジョブの削除は元T22の残件。Stripe CustomerはテストSessionの所有関係とテストモードを確認して削除するが、Checkout Sessionや決済履歴そのものはStripe APIから削除できない。Supabaseバックアップを含む30日以内の実保持条件は、公開前に提供プランと復元可能期間を確認するまで合格扱いにしない。本人操作・期限ジョブ・失敗からの再試行をHosted環境で検証し、結果を記録する。

## 9. リリース前の確認

- 検証中は固定PreviewのみHosted Supabaseへ接続し、Productionと同時接続しない。切替後はProductionのみ接続し、通常のPR PreviewにHosted秘密を渡さない。
- `main`のCI必須チェックがmergeを保護し、Productionに認証省略とライブStripe鍵が存在しない。
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
