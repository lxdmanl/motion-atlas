# 開發紀錄

## 2026-10-04

- 匯入 human-atlas 固定 commit，保留 upstream/main 與授權，建立 codex/live-anatomy-demo。
- 依三張 Moti Physio 參考圖建立 DESIGN.md，完成繁體中文全身／右臂 3D 工作台。
- 以 Blender 4.5.14 製作原始右臂蒙皮：84 atlas 部件、2 個肌腱示意，保留可編輯 .blend 與三姿勢 QA。
- 隔離安裝 Blender MCP 2.1.3，完成 36 tools handshake 及場景讀取。官方 Playwright skill 已安裝；使用 ui-ux-pro-max、designmd-uiux、openai-docs 方法查核與驗證。
- MediaPipe 1.0.1 + full float16 v1 本機模型，Worker 右肩／肘／腕追蹤、平滑、失追與釋放機制。
- 實作 GPT-Live WebRTC、Responses delegation 與 Realtime fallback；後端管理 API key 與正式關閉連線，工具操作等待畫面繪製成功。
- TypeScript、production build、32 個單元／服務測試、10 個瀏覽器測試通過。使用者回報相機角度與模型會隨動。
- 3D 長時間測試與完整語音現場驗收各自記錄；不將示範或 mock 稱為實際量測／真正語音連線。
- 純3D 10分鐘soak通過，61次採樣59–60 FPS，geometry114 / texture2未增加；真人相機連动由使用者確認，語音仍待key。
