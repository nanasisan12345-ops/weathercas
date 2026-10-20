import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main><img src={`${import.meta.env.BASE_URL}assets/weathercas-logo.png`} alt="ウェザキャス WeatherCas" width="400" /><h1>出演情報も、ライブ視聴も。</h1><p>ウェザーニュースLiVE 非公式ファンサイト</p><p>公式データ接続を準備しています。架空の出演情報は表示しません。</p></main>
  </React.StrictMode>,
);
