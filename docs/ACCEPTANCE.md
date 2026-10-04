# 驗收紀錄 — 2026-10-04

狀態：可操作的本機 3D／相機預覽已交付；完整語音版仍待 API Key 與現場測試。不建立 `demo-v0.1.0` 完整驗收標籤。

## 可重現檢查

| 項目 | 本次結果 | 證據／命令 |
| --- | --- | --- |
| TypeScript | 通過 | `npm run check` |
| Production build | 通過 | `npm run build` |
| 單元與服務测试 | 32 通過 | `npm test`；14 姿態、18 server/voice |
| 真實 Worker 瀏覽器測試 | 4 通過 | `app/tracking/pose.browser.spec.ts`；本機真 WASM／模型、空圖推論、拒權、停止清理與模型失敗 |
| 工作台瀏覽器測試 | 6 通過 | `tests/workspace.spec.ts`；真 WebGL、展示角度、圖層、選取、缺 key、模型503後重試 |
| 正式建置瀏覽器測試 | 1 通過 | 3017 使用 `dist/assets`、無 Vite client；真 WebGL、展示滑桿 110° 及退出歸零，無 pageerror |
| 畫面尺寸 | 通過 | 1366×768、1920×1080，沒有頁面水平溢出；右側面板允許垂直捲動 |
| 原始網格保留 | 通過 | `node scripts/validate-arm.mjs`；84 個原始 part ID、三角形及所有原頂點位置保留 |
| 匯出對齊 | 通過 | 最大靜止位置誤差 `9.78e-8 m`；`assets/qa/validation.json` |
| 0°／60°／110° 形態 | 可用的教學形變，有限制 | 三張 Blender QA 圖；大角度肌肉可變薄、局部折疊或露出骨面，未做生理精度驗證 |
| 本機姿態資產 | 通過 | `node scripts/setup-pose.mjs --verify`；7 檔固定大小與 SHA-256 |
| Blender MCP | 通過 | 2.1.3，36 tools，scene/object 讀取成功；`assets/qa/mcp-validation.json` |
| Git / LFS | 已建立 | 上游歷史保留，`codex/live-anatomy-demo`；資產與實作分開提交 |
| 真人相機基本連動 | 使用者確認通過 | 使用者在本次對話回覆「角度與模型會隨動」；未記錄私人影片 |
| 10 分鐘 3D 穩定性 | 通過 | 暖機15秒後測量600.025秒、61次採樣；59–60 FPS，中位60；geometry114 / texture2固定，無pageerror。`docs/qa/3d-soak-2026-10-04.json` |

瀏覽器截圖位於 `output/playwright/workspace/`；測試輸出與追蹤檔不加入 Git。BodyParts3D 解剖 QA 圖不包含私人影像，可保留版控。

純3D測試使用 Chrome 154、1366×768；同一台電腦可能同時執行使用者預覽、其他測試及建置。JS heap首129.4MB、末122.2MB，範圍106.9–167.6MB，含GC波動。固定物件數不等於完全排除所有CPU/GPU記憶體洩漏。每10秒採樣與示範週期接近，採到的角度範圍不可用作完整活動範圍。

## 待實際驗證

- 真正 GPT-Live / Realtime 連線及帳號存取權；目前未設定 OpenAI API Key。
- 至少 10 輪繁體中文語音與畫面工具、打斷、靜音、結束、重連。完整程序見 [VOICE.md](VOICE.md)。
- 真實使用者相機每秒姿態更新率及校準後角度精度。使用者已確認連動，但此回覆不含量化性能。
- 相機＋3D＋真語音同時運行的 10 分鐘現場展示與音訊連線／記憶體監測。純 3D soak 不能代替完整 live demo。
- 肌肉變形的解剖專家驗收；現有權重是教學形變而非生物力學模擬。

## 狀態定義

「LIVE」只用於 camera source 的有效追蹤。「DEMO」與「示範」代表手動／正弦動畫。追蹤品質低於 0.65 或資料超過約 500 ms 時清除量測；AI 工具再以 1.5 秒新鮮度閘門防止過期資訊。無相機時角度是 `null`，不以 0° 假裝量測。

語音 mock／單元測試只能證明事件與失敗處理分支，不證明 OpenAI 真實服務、收音、中文識別或音訊延遲。欠缺這些驗收時不標示整體計畫已全部完成。
