# データ取得元と確認範囲

調査日: 2026-10-20。一次ページの実HTML、JSON、HTTP状態、公式ドキュメントを確認。実応答の調査用控えはローカルの `Data/research/`（Git対象外）。第三者参考サイトの内容・DB・画像は取得していない。

|取得元|項目・方法|頻度・確度・障害時|
|---|---|---|
|[公式番組表](https://weathernews.jp/wnl/timetable.html) / [公開JSON](https://site.weathernews.jp/site/live/json/timetable.json)|公式ページのスクリプトが直接参照する認証不要GET。hour/title/casterの並び。日付なし、先頭が現在枠という公式画面の表示意味を利用。出演実績ではない。|3時間ごと1GET。JST取得時刻以前の直近の先頭時刻を起点に、時刻の巻き戻りで翌日に進む。起点が6時間より古い場合・48時間超の範囲・未知構造は採用しない。`date_basis=rolling_schedule` を保存。予定として保持し、未掲載の過去枠を補完しない。失敗時は過去JSONを維持。|
|[公式トップ](https://weathernews.jp/wnl/)|caster_trans/caster_kanjiの対応を実HTMLから確認し `config/casters.json` にID・表示名・別名を記録。|現時点21名の表示名対応表。現役名簿や全在籍者数を意味しない。未知IDは日本語名を捏造せず未確認。顔画像は収集しない。名前変更は対応表をレビューして更新。|
|[公式動画一覧JSON](https://site.weathernews.jp/site/live/json/list.json)|公式トップで利用。live.id/title/live、ondemandのID・タイトル・公開時刻のみ。|3時間ごと1GET。`live: true` は「公式掲載・取得時点」。現在配信を保証する情報ではない。公開時刻は配信開始時刻とみなさない。失敗時はLIVE表示を停止し正規リンクへ。アーカイブは最新一覧の範囲のみで、出演記録へ自動変換しない。|
|[YouTube oEmbed](https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=LbMd2BvWHHU&format=json)|公式JSONで得たIDを問い合わせ、author_url=@weathernews、type=video、埋め込みURLを確認。返されたHTMLを画面に挿入しない。|候補1件につき最大1GET/更新。認証不要。埋め込み可能な公式動画候補の確認用で、LIVE状態の検証ではない。失敗時はiframeを出さない。|
|[YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list) / channels.list|任意のActions Secret `YOUTUBE_API_KEY` がある場合のみ。公式ハンドルのチャンネルIDと一致し、public・embeddable・liveBroadcastContent=live・actualStartTimeあり・actualEndTimeなしを検証。|更新あたり原則2リクエスト、各1 unit。検索APIを使わない。キーはHTTPヘッダーのみで送信。認証付き実通信はキー未設定のため未検証。無設定時も公式掲載動画の通常埋め込みは利用でき、現在LIVEとは表示しない。APIエラーで以前のLIVE判定を引き継がない。|

## 利用条件・アクセスの扱い

- [weathernews.jp robots.txt](https://weathernews.jp/robots.txt) を確認。今回の /wnl/ は列挙されたDisallowに該当しなかった。site.weathernews.jp の robots.txt は403で確認できなかった。JSON自体は200、公式ページが一般閲覧者向けに公開している取得先。robotsは転載許諾を意味しない。
- 公開JSONについて再配布を包括的に許すライセンスは確認できていない。表示するのは日時・番組名・出演者名など必要最小限の事実と出典。元HTML/顔写真/動画/サムネイル/記事本文を収蔵・複製しない。公開運用者は利用条件の変更・削除要請に対応し、必要に応じ取得を停止する。
- 公開JSONのクォータ仕様は未公表。並列大量収集・過去URL探索を行わず、タイムアウト20秒、429/5xx/通信障害のみ最大3試行。指数バックオフとRetry-After上限30秒。予定収集は1日8回。ローカル実行は短時間で何度も繰り返さない。
- [YouTube APIポリシー](https://developers.google.com/youtube/terms/developer-policies) を参照。APIキー・ユーザーの認証情報は公開しない。YouTube APIの応答は一時的な現在状態の検証に限り、古いAPIメタデータを無期限保存しない。検索APIの割当は変更されうるため実際のCloud Consoleで確認する。
- [YouTube埋め込み仕様](https://developers.google.com/youtube/player_parameters) に沿う通常iframe。プライバシー強化ドメインを使用し、利用者が表示を選んでから読み込む。YouTubeのUI・広告・ロゴは隠さない。
- [番組映像ガイドライン](https://weathernews.jp/wnl/guideline/) とYouTube側の条件は別々。録画は `FEATURE_LOCAL_CAPTURE=false`、実際の録画処理も組み込まない。クリップ機能はURLと再生位置のメモのみ。

## できること・できないこと

公式のローリング番組表を定期観測して、確認できた予定とその変更履歴を蓄積する。過去全期間の埋め戻し、実際の出演確認、自動的な全出演者の判別は実装していない。予定が過去になっても確認済みに変換しない。未確認を統計に加算しない。番組名や時刻は取得値を使い6枠に固定しない。

## 定期実行

[GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) の遅延・無活動リポジトリの停止等を考慮。初期設定はUTCで `23 */3 * * *`、JSTでは0/3/6/9/12/15/18/21時23分。リアルタイム保証はない。UIは4時間以上前の収集を期限切れとし、LIVE判定は15分で失効する。
