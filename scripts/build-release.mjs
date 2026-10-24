import { build } from 'vite';
import { mkdir, cp, writeFile, readdir, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `weathercas-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const target = path.join(root, 'release', name);
await mkdir(target, { recursive: true });
await build({ root, define: { 'import.meta.env.VITE_LIVE_ENDPOINT': 'undefined' }, build: { outDir: path.join(target, 'site') } });
await mkdir(path.join(target, 'scripts'));
for (const name of ['serve-static.mjs', 'live-source.mjs', 'live-resolver.mjs', 'schedule-source.mjs', 'weather-source.mjs', 'recording-api.mjs', 'recording-service.mjs', 'recording-format.mjs', 'recording-tools.mjs']) {
  await cp(path.join(root, 'scripts', name), path.join(target, 'scripts', name));
}
await mkdir(path.join(target, 'config'));
await cp(path.join(root, 'config/casters.json'), path.join(target, 'config/casters.json'));
await cp(path.join(root, 'config/recording-tools.json'), path.join(target, 'config/recording-tools.json'));
await cp(path.join(root, 'DATA_SOURCES.md'), path.join(target, 'DATA_SOURCES.md'));
await writeFile(path.join(target, 'run.bat'), '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "NODE_USE_SYSTEM_CA=1"\r\nset "TEMP=%~dp0Data\\temp"\r\nset "TMP=%~dp0Data\\temp"\r\nif not exist "%TEMP%" mkdir "%TEMP%"\r\nnode scripts\\serve-static.mjs %*\r\npause\r\n');
await writeFile(path.join(target, 'README.md'), `# ウェザキャス ローカル確認版

Windows 64bitとNode.js 24以降を用意し、run.batをダブルクリックしてください。npmの依存インストールは不要です。URLは http://127.0.0.1:5180/weathercas/ 。停止は録画停止後にコンソールのCtrl+Cです。ポート使用中の場合はWEATHERCAS_PORT環境変数で変更できます。

動画のすぐ下の「録画開始」で、配信の映像と音声を再圧縮せずMP4に保存します。「録画停止」後にプレビューと「MP4をPCに保存」が表示されます。プレイヤーのタイトル・操作UI・マウスやコメント欄は入りません。配信に含まれるテロップは残ります。最大1080p・60fpsで、配信が30fpsなら30fpsのままです。画面の表示サイズやミュート状態は録画に影響しません。録画は最新の配信地点から始まり、巻き戻した視聴位置とは一致しません。

初回録画時にSHA256を固定したyt-dlp/FFmpegをGitHubからData/toolsへダウンロードします。録画はData/recordingsへ保存し、最大30分・約2GBで停止します。許諾済みの公式公開配信のみが対象で、ログイン必須・DRM付き配信は非対応です。ブラウザーを閉じてもサーバー起動中は録画が続くので、終了前に「録画停止」を押してください。過去の録画は次の録画後もData/recordingsに残ります。

写真・天気図・YouTube・チャットにはインターネット接続が必要です。専用Edgeのブラウザー状態・初回ダウンロード先・ログ・キャッシュはこのフォルダー内のDataです。既存ブラウザー設定は上書きしません。Dataは初期配布には含まず、起動時に作成します。

保存履歴はビルド時点のデータです。起動中のNodeサーバーは配信先を60秒キャッシュで確認し、動画とチャットを更新します。現在の番組表も60秒キャッシュで取得し、画面は5分ごととタブ復帰時に確認します。現在予定の表示だけに反映し、保存履歴は書き換えません。配信タイトルから照合できたキャスターの写真・氏名・公式プロフィールも表示します。SNS投稿の埋め込みはありません。録画欄はlocalhost/127.0.0.1のHTTPローカル起動時だけ表示し、公開サイトではボタンや起動案内を表示しません。

天気情報は32種類から表示するカードを選べます。「表示・配置をカスタマイズ」で表示・順番・幅を変更し、この専用Edgeに保存します。公式データは表示中のカードだけ5分ごとに確認します。このフォルダー単独では履歴の定期収集を実行しません。検索エンジン向けにnoindexを指定していますが、アクセス制限はありません。exe・_internalはWebアプリのため含みません。
`);
const files = [];
async function audit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await audit(full);
    else { const bytes = await readFile(full); files.push({ path: path.relative(target, full).replaceAll('\\', '/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  }
}
await audit(target);
if (files.some(file => /(^|\/)(Data|node_modules|tests|WeatherCas_Starter_Package)(\/|$)|\.(webm|mp4|log)$/.test(file.path))) throw new Error('Unexpected runtime or verification file in release');
await mkdir(path.join(root, 'Data/verification'), { recursive: true });
await writeFile(path.join(root, 'Data/verification/release-inspection.json'), JSON.stringify({ target, checked_at: new Date().toISOString(), files, initial_Data_present: false, exe: 'not applicable', internal: 'not applicable' }, null, 2));
console.log(`Fresh review folder: ${target}`);
