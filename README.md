# Motion Atlas — 3D 動作與語音解剖工作台

本機瀏覽器工作台：探索全身解剖模型、以相機估計右肘動作，並透過中文語音操作模型。以 human-atlas 為基礎，保留其 Git 歷史、MIT 程式授權與 BodyParts3D 署名。

**目前狀態：3D 預覽、展示動畫及相機推論管線可運行；真實語音尚待本機 API Key 與現場驗收。** 不把模擬測試等同真人追蹤或真正語音成功。完整紀錄見 [驗收紀錄](docs/ACCEPTANCE.md)。

## 啟動

需要 Node.js 22.13+、Git LFS 與 Chrome / Edge。

```powershell
git lfs install
git clone https://github.com/lxdmanl/motion-atlas.git
cd motion-atlas
git lfs pull
npm ci
node scripts/setup-pose.mjs --verify
npm run dev
```

開啟 **http://127.0.0.1:3016/**。API 在 127.0.0.1:3017，只監聽本機。這份交付已包含本機模型；若缺少姿態資產，執行 `npm run assets:pose` 重新下載並核對固定雜湊。

正式建置預覽：停止開發伺服器後，執行 `npm run build`、`npm start`，開啟 **http://127.0.0.1:3017/**。首次安裝需要網路；模型與 WASM 之後由本機提供。相機與 3D 不需要 OpenAI Key，語音及文字提問需要網路與 API Key。

## 試玩

1. 拖曳模型旋轉、滾輪縮放；左側切換全身／右手臂與圖層。
2. 按「展示模式」，用滑桿或播放按鈕觀察 0–130° 右肘形變。所有資料標為示範。
3. 點選右側肌肉，聚焦及高亮原始結構。
4. 關閉展示或直接「開啟相機」。側身讓右肩、肘、腕入鏡；角度失效時顯示破折號並停止更新模型。
5. 設定語音後說「放大我的右手臂」、「只顯示骨骼」、「介紹這個動作可能相關的肌肉」。

相機需要瀏覽器權限。若 Codex 內嵌預覽無法取得相機，請在 Chrome / Edge 開啟同一網址並允許網站使用相機。畫面顯示的品質是姿態追蹤信心，不是肌肉活化比例。

## OpenAI 設定

本機已有不含金鑰的 `.env.local` 範本；新的 checkout 可由 `.env.example` 複製。只在本機編輯 `OPENAI_API_KEY`，不要設定 `VITE_` 金鑰欄位。設定後重新啟動 API。

- 優先 `gpt-live-1`；只有明確模型／權限不支援時改用 `gpt-realtime`。
- `OPENAI_TEXT_MODEL` 預設 `gpt-5.6-luna`，供文字與 Live delegation；需有對應帳號權限。
- 瀏覽器使用 WebRTC、字幕、靜音、中斷與服務端關閉連線；語音只讀動作摘要，不上傳相機影片。
- 真正連線、中文效果、音訊中斷及至少 10 輪測試仍待驗證。[完整設定與測試](docs/VOICE.md)。

## 版本與重建

上游固定來源：`1c38bf35c254a891200d3cedecfd57abebe83d8d`；來源基線保留於 `upstream/main`，本機開發位於 `codex/live-anatomy-demo`。GitHub 儲存庫為 [lxdmanl/motion-atlas](https://github.com/lxdmanl/motion-atlas)，交付分支為 `main`；網站尚未公開部署。完整語音及現場驗收完成前不建立 `demo-v0.1.0` 標籤。

- `app/workspace.tsx`：繁中工作台；`app/motion-scene.tsx`：獨立 Three.js 迴圈。
- `app/tracking/`：MediaPipe Worker、右肘角度、平滑、失追与資源釋放。
- `app/voice/`、`server/`：WebRTC、Responses、嚴格工具參數及後端金鑰。
- `assets/right-arm.blend`、`public/models/right-arm.glb`：可重建的原始右臂蒙皮，84 個 atlas 部件及 2 個肌腱路徑示意。
- `.blend`、`.glb`、`.task`、`.wasm` 由 Git LFS 管理；中間模型、私人裝置資料及工具安裝目錄不入 Git。
- Blender 4.5.14 LTS、mcp-for-blender 2.1.3 已隔離安装；網站運行不需要 Blender。[資產重建及 MCP 啟停](docs/ASSETS.md)。

## 檢查

```powershell
npm run check
npm test
npm run build
npm run test:e2e
node scripts/validate-arm.mjs
node scripts/setup-pose.mjs --verify
```

Playwright 使用已安裝的 Chrome；輸出在 `output/playwright/`。需要 10 分鐘 3D 穩定性檢查時，在 PowerShell 執行：

```powershell
$env:RUN_SOAK='1'
npx playwright test tests/soak.spec.ts
Remove-Item Env:RUN_SOAK
```

## 範圍與限制

第一版只驅動右肘屈伸，其他身體結構用於定位。MediaPipe 的單眼 3D 是估計；不提供精確人體重建、診斷、活化百分比或肌腱張力。骨骼保留剛性，肌肉使用教學蒙皮；大屈曲時仍可見肌肉變薄與局部穿插，並非生物力學模擬。右側肌腱由補充路徑繪製，不是原資料的獨立肌腱分割。

使用前參閱 [資料署名](public/ATTRIBUTION.md)、[第三方來源](public/THIRD_PARTY.md)、[介面設計](DESIGN.md)。上游原說明另存於 [UPSTREAM_README.md](docs/UPSTREAM_README.md)。
