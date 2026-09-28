# T45 公開MVP検収の実施範囲

更新日: 2026-09-29

## CIで実行する公開MVPの追加ケース

- `tests/e2e/t45-mvp-journey.spec.ts`: 独立した2つのPlaywrightブラウザーで匿名デモ会員を開始し、トップの検索、商品詳細、カート、架空住所、正式見積まで操作する。ユーザーID・住所ID・見積IDが分離され、他方の住所で見積APIを呼ぶと404になることを検証する。認証、商品探索、カート追加、見積とRLS拒否は実アプリおよびCIローカルSupabaseを通す。
- `tests/e2e/t45-mvp-performance.spec.ts`: Chromium PerformanceObserverでトップページのLCP候補、CLS、単一の実ブラウザー操作から得たINP候補を計測する。JSONをPlaywright添付とCIログの`T45_WEB_VITALS`行に出力し、設計目標（LCP 2,500ms、CLS 0.1、INP 200ms）との比較結果も記録する。

再実行はCIの`Catalog UI browser tests`ジョブ内で、ローカルSupabaseのseed後に実行する。ローカルではCIと同じ環境変数を設定した上で `npx playwright test tests/e2e/t45-mvp-journey.spec.ts tests/e2e/t45-mvp-performance.spec.ts` を実行する。性能値は単一実行のローカルChromium＋Next.js開発サーバーの参考値であり、通常利用環境における目標達成の証明ではない。性能合否として扱うには、複数回の本番相当・Hosted Preview計測と結果のレビューが必要。

2026-09-29のローカル参考実行を2回行い（Chromium、1280×800、Next.js開発サーバー）、LCP候補276msと260ms、CLSはいずれも0、単一interactionのINP候補は16msと24msだった。JourneyはローカルSupabase URL/公開鍵が利用できずskipしたため、この結果に含まれない。値は同じ環境での傾向確認にのみ使い、CIとHosted Previewの測定結果で再評価する。

## 未検証の境界

この公開MVP差分はCheckout開始API、Stripe Checkout Session作成、支払い成功・失敗画面、注文履歴への統合を通した証拠ではない。T35のDB競合/Webhook RPC試験、T31のWebhook状態処理、T33の結果画面テストは別の層のテストとして維持し、全体E2E証拠へ読み替えない。Hosted Previewでの実Stripeテスト通知、注文・在庫と結果/履歴の一致はT49の検収に残す。Google、SMTP、SMSおよびT42追加デモは公開後の対象である。

この範囲はT45元チケットの一部であり、T45全体の完了を示さない。
