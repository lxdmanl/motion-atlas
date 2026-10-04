# 本機語音設定與驗收

本功能使用瀏覽器 WebRTC 連接 OpenAI 語音服务。攝影機姿態在本機處理；語音只讀取右肘動作摘要、解剖知識及畫面工具。語音不接收相機影片，也不量測肌肉活化或肌腱受力。

**驗證狀態：程式與 mock 測試已完成，尚未使用真正 API key 完成語音連線或以下十輪現場驗收。** 不得將測試通過解讀為已驗證麥克風、揚聲器、中文辨識、帳號模型權限或實際延遲。

## 啟動

需要 Node.js 22.13 以上、Chrome 或 Edge，以及可連接 OpenAI API 的網路。

1. 在專案根目錄執行 `npm install`。
2. 自行建立 `.env.local`，填入 `OPENAI_API_KEY=你的專案金鑰`。不要把真實值貼到聊天、截圖、終端輸出或版本控制。
3. 可選模型設定：`OPENAI_LIVE_MODEL=gpt-live-1`、`OPENAI_REALTIME_MODEL=gpt-realtime`、`OPENAI_TEXT_MODEL=gpt-5.6-luna`。文字模型同時供文字提問及 GPT-Live backend 使用；請選擇該 API 專案有權使用的模型。
4. 開發：`npm run dev`，開啟 [開發網站](http://127.0.0.1:3016)。API 固定在 `127.0.0.1:3017`，Vite 代理 `/api`。
5. Production 預览：`npm run build` 後執行 `npm start`，開啟 [本機正式建置](http://127.0.0.1:3017)。缺少 `dist/index.html` 時會顯示建置提示；API 仍可使用。
6. 設定變更後重新啟動 API。`GET /api/health` 只回傳是否有設定金鑰與模型名稱，不回傳金鑰內容。

只設定 `OPENAI_API_KEY`，**不要使用 `VITE_OPENAI_API_KEY`**。`.env.local` 由 Node 後端透過 dotenv 載入；瀏覽器拿到 SDP 與僅供關閉該連線的隨機 token，沒有專案 API key。不要公開此開發伺服器。

## 連線與失敗處理

- 缺 key：明確顯示未設定，保持 3D／展示模式可用，不請求麥克風或顯示「已連線」。
- 啟動：先檢查後端，再取得麥克風；只有收到 provider ready 事件才顯示連線成功。
- 優先 GPT-Live。只有明確模型／存取權錯誤才嘗試 Realtime；401、額度不足、429、網路及 5xx 錯誤不會觸發替代通話。實際 provider 必須在介面顯示。
- 靜音只停用麥克風輸入，**不代表已結束計費連線**。結束按鈕停止本機收音，後端向 provider 關閉：GPT-Live 使用 sideband `session.close` / `session.closed`；Realtime 使用 call hangup。
- 關閉未確認時保留 session 與 close token，允許再次結束；不要新建 connector 覆蓋它。連線意外遺留時，後端會對超過 20 分鐘的 session 嘗試關閉；這不是免費等待時間。
- 中斷：Realtime 取消 response 並清除輸出音訊 buffer；Live 先停本機播放、要求模型停止，之後的新使用者語音及助理字幕才重新啟用播放。此行為仍須用實際麥克風與喇叭驗證。
- 工具只有 `get_motion_state`、`get_anatomy_info`、`highlight_structures`、`set_anatomy_view`。構造 ID 與參數有允許清單；畫面操作必須成功回報才能宣稱已完成。
- 動作資料超過 1.5 秒、品質低於 0.65、不是右肘或 angle 不合法，傳給 AI 的角度為 `null`，階段為 `unknown`。示範資料始終保留 `source: demo`；不能說是目前攝影機量測。

## 真實十輪驗收（全部待驗證）

每輪記錄日期、瀏覽器、provider/model、結果與可觀察延遲；勿保存 API key。可使用文字記錄，不必錄製私人影片。

| 輪次 | 操作或問題 | 必須觀察到的結果 | 狀態 |
|---|---|---|---|
| 1 | 允許麥克風，按開始語音，說「你好」 | 真正聽到繁中回答、有字幕；只在 ready 後顯示已連線及實際 provider | 待驗證 |
| 2 | 相機未啟動，問「我現在彎了幾度？」 | 說明目前沒有可靠姿態，不猜角度 | 待驗證 |
| 3 | 開啟展示模式，問「現在做什麼？」 | 清楚標示／說明示範資料，不稱為相機實測 | 待驗證 |
| 4 | 相機追蹤右肘，問「目前彎曲多少？」 | 讀取新鮮摘要；角度與畫面近似，說明是估計 | 待驗證 |
| 5 | 遮住手腕或離開畫面，再詢問 | 不沿用舊角度，不猜測即時肌肉作用 | 待驗證 |
| 6 | 「放大右手臂，標出肱二頭肌」 | 實際切換視角與可見圖層，原始 mesh 高亮；失敗時不宣稱成功 | 待驗證 |
| 7 | 「切換骨骼，標出肱骨；再看肱三頭肌肌腱」 | 圖層与選取同步，肌腱明確是示意，不聲稱真實受力 | 待驗證 |
| 8 | 回答中按中斷，再問另一個問題；靜音後說話 | 舊回答停止，新回答可正常播放；靜音輸入不會觸發新問題 | 待驗證 |
| 9 | 結束，檢查麥克風燈號；再連線一次 | 裝置釋放、服務端關閉確認，重新連線只有一個 active session | 待驗證 |
| 10 | 測試 Live 無模型權限及網路故障 | 只有模型／access 錯誤切換且顯示 Realtime；網路／額度錯誤如實呈現，關閉失敗可重試 | 待驗證 |

此外：拒絕麥克風權限、在連線中途關閉頁面、WebGL context loss 後要求畫面操作，都需實機補測。`npm test` 的 mock 無法證明這些硬體與 provider 行為。

## 測試與官方參考

執行 `npx vitest run server/voice.test.ts app/voice/VoiceSession.test.ts`，檢查授權、工具邊界、過期資料、provider fallback、結束確認、裝置清理與重連。

- [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc)
- [GPT-Live delegation 與工具](https://developers.openai.com/api/docs/guides/live-delegation)
- [Session 結束與字幕](https://developers.openai.com/api/docs/guides/live-conversations)
- [Realtime WebRTC 通話結束](https://developers.openai.com/api/reference/python/resources/realtime/subresources/calls/methods/hangup)
- [語音計費說明](https://developers.openai.com/api/docs/guides/voice-latency-cost)

GPT-Live 時長與 backend 用量分開計費；請依模型頁及實際 usage 核對。任何延遲數字都應由現場驗收量測，不能由單元測試推論。
