# 右手臂資產與 Blender MCP

## 來源、範圍與授權

固定來源為 [ashemag/human-atlas](https://github.com/ashemag/human-atlas/tree/1c38bf35c254a891200d3cedecfd57abebe83d8d)，commit `1c38bf35c254a891200d3cedecfd57abebe83d8d`。幾何來自該版本的 `public/models/atlas.json` 與其二進位 chunks，原資料為 BodyParts3D 4.0。來源 atlas 已做過簡化與座標轉換；本專案保留的是這份 atlas 的幾何，不是未簡化的原始 OBJ。完整署名與目前資料庫授權見 [public/ATTRIBUTION.md](../public/ATTRIBUTION.md)。

本次取出 84 個原始右上肢部件，合計 58,997 個來源頂點、58,060 個來源三角形，包含肩帶、上臂、前臂、腕部和手部。原始骨骼與肌肉保持各自的 part ID。兩個來源分類修正會保留 `sourceSystem`：`FJ1471` 腕屈肌支持帶歸入 connective，`FJ1504` 肩胛下肌歸入 muscular。

另外製作兩個附著路徑示意網格：`tendon-biceps-distal`、`tendon-triceps-distal`。它們的 `userData.schematic=true`，不是資料集分割出的肌腱組織，也不取代原有肌肉。

## 固定工具版本

| 工具 | 版本與來源 |
| --- | --- |
| Blender portable | 4.5.14 LTS，Windows x64，官方 [ZIP](https://download.blender.org/release/Blender4.5/blender-4.5.14-windows-x64.zip) / [SHA-256](https://download.blender.org/release/Blender4.5/blender-4.5.14.sha256)，Blender GPL 授權 |
| Python | Blender 隨附 3.11.15；以此建立專案獨立 venv，不使用或修改 Anaconda |
| MCP for Blender | [`mcp-for-blender==2.1.3`](https://pypi.org/project/mcp-for-blender/2.1.3/)，[作者原始碼](https://github.com/ahujasid/mcp-for-blender)，MIT；第三方工具 |
| Add-on | 同一個 2.1.3 Python wheel 內的 bundled/addon.py；add-on 版本標記 1.8、通訊協定 13 |
| MCP Python SDK | 1.30.0；完整依賴固定於 `scripts/blender-mcp-requirements.txt` |

此版 Windows ZIP 的 SHA-256 已核對為：

```text
b9533d2397ac1984db4466fb23a7a4649391cca93f6e84209f9bcc60d071c8b9
```

所有本機工具、下載 ZIP、venv、Blender 設定檔和執行 PID 都放在 `.tools/`，不加入 Git。

## 從現有 repository 重建

在專案根目錄使用 PowerShell 執行。Node 套件先依 repository lockfile 安裝；驗證腳本使用本專案的 Three.js。

```powershell
npm ci
# 缺少 portable Blender 時會從上述官方來源下載並驗證 SHA-256。
# 安裝固定 MCP 依賴，建立本機專案 Blender profile；不會註冊 Codex 或開啟 GUI。
./scripts/setup-blender-mcp.ps1

# 從固定 atlas 部件重建中間資料。
node scripts/extract-arm.mjs

# 建立個別原始網格、兩骨骼蒙皮、GLB、manifest、三張 QA 圖及可編輯 .blend。
& '.tools/blender-4.5.14-windows-x64/blender.exe' --background --python scripts/build-arm.py

# 透過 Three.js GLTFLoader 和 CPU 蒙皮驗證匯出結果。
node scripts/validate-arm.mjs
```

第一次 setup 需要網路下載。現有安裝的重建不需要 MCP 服務啟動。`assets/right-arm-source.json` 是可重建的大型中間檔，`assets/qa/build.log` 是本機 log，兩者不加入 Git。Blender 可能建立 `.blend1` 備份，亦不加入 Git。

保留交付的檔案：

- `public/models/right-arm.glb`：3,109,960 bytes，網站直接載入的 86 個網格與兩根控制骨。
- `public/models/rig.json`：來源 IDs、校準座標、旋轉方向、註記位置、權重範圍與限制。
- `assets/right-arm.blend`：可編輯原始網格、vertex groups、armature、QA 相機及燈光，儲存為 0°。
- `assets/qa/right-arm-000.png`、`right-arm-060.png`、`right-arm-110.png`：三個角度的實際 Blender 渲染。
- `assets/qa/validation.json`：Three.js 資產驗證結果。
- `assets/qa/mcp-validation.json`：本機 MCP 協定與場景讀取驗證結果。

## 網站載入契約

Atlas 使用公尺與 Y-up。建模時轉成 Blender 的 Z-up，GLB 匯出時還原；GLB 應以世界座標 identity 加入原 atlas。移除或隱藏 `rig.replacedPartIds` 對應的靜態原部件，防止重疊。

`upper_arm_fixed` 固定肩膀／上臂；`elbow_flexion` 控制前臂。肘軸由肱骨遠端 25 mm 頂點帶的主方向估計，不是臨床校準。GLB 的 rest quaternion 並非 identity，必須在 rest quaternion 後乘上局部 X 軸旋轉：

```javascript
const rest = elbowBone.quaternion.clone();
// 每次更新皆從 rest 開始；theta 為 0 至 130 度的屈曲角。
elbowBone.quaternion.copy(rest).multiply(
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), -theta * Math.PI / 180
  )
);
```

不能直接設定 `rotation.x=-theta`，也不能把每幀旋轉持續累乘。骨骼僅有肘屈伸自由度，手與腕跟隨前臂；沒有肩旋轉、腕動作、手指動作或前臂旋前／旋後控制。

## 已完成的 QA 與實際限制

`node scripts/validate-arm.mjs` 實測通過：84 個原始 ID 全數存在；每個來源三角形計數保持一致；所有來源頂點位置皆可在靜止 GLB 找到。匯出可能因 split normals 複製頂點，故 GLB 頂點總數不要求與原來源相同。rest 位置最大誤差約 `9.78e-8 m`。另確認兩個示意肌腱標記、0°／60°／110° 的肱骨中心保持不動，前臂在屈曲時向前上方移動。

三張 QA 圖確認原部件連續跟隨骨架，沒有整塊肌肉停留在原位置。肌肉採依部件手工指定區間的兩骨骼 linear blend skinning。60°、110° 的肘部可見變薄、局部折疊，以及肱骨露出；尚未加入體積保持、肌肉鼓起、碰撞、滑移、包覆或姿勢修正 shape keys。130° 為 UI 允許範圍上限，未列入這組渲染 QA，也不是量測到的生理活動度。

這些檢查驗證匯出與視覺旋轉正確，不能證明組織形變、生物力學或臨床準確性。此模型不會測量或模擬肌肉啟動、肌腱負荷、肌力或病理；鏡頭推估角度的準確性需在姿態追蹤流程另外驗證。未包含於此 rig 的神經、血管等 atlas 部件仍為靜態；網站不要把它們當作同步變形的右手臂結構顯示。

## 使用 Blender MCP

MCP 僅供開發時檢查和編輯 `.blend`。網站執行時只使用輸出的 GLB，不依賴 Blender、Python 或 MCP。

```powershell
# 將本專案的 pinned MCP 加入 Codex 使用者設定，保留其他 entry。
./scripts/setup-blender-mcp.ps1 -ConfigureCodex

# 啟動專案 Blender 和 localhost:9876 bridge，預設隱藏視窗。
./scripts/setup-blender-mcp.ps1 -Launch

# 若自己需要操作可見 Blender 視窗，首次啟動時使用：
./scripts/setup-blender-mcp.ps1 -Launch -ShowWindow

# 直接驗證 stdio MCP handshake、tool list、scene 和 RightArmRig 的只讀查詢。
& '.tools/blender-mcp-venv/Scripts/python.exe' scripts/check-blender-mcp.py
```

已驗證 36 個工具、通訊協定 13、`get_scene_info`、`get_object_info` 成功。註冊的 server 名稱是 `blender`；新設定需要重啟 Codex 才載入當前工具清單。`codex mcp get blender --json` 可查看設定；應在同一個 Windows 使用者下執行，沙盒帳號的 Codex profile 可能不同。

設定使用 `BLENDER_MCP_SAFE_MODE=1`、`DISABLE_TELEMETRY=true`，add-on 的 telemetry consent 為 false；停用 add-on 自動更新檢查以維持 pinned 版本。僅開啟 localhost socket，不設定外部生成服務或 API key。設定及驗證紀錄只含本機路徑、版本、幾何與場景資料，沒有使用者 API key 或帳號憑證。safe mode 是 MCP Python 執行驗證，並非作業系統隔離；這個 localhost bridge 只供受信任的本機工具使用。

本次完成時保留專案的隱藏 Blender 服務，方便 MCP 繼續使用。停止時只針對 `.tools/blender-mcp.pid` 記錄的本次程序，不使用 `Stop-Process -Name blender`：

```powershell
$projectBlenderPid = [int](Get-Content -LiteralPath '.tools/blender-mcp.pid')
$projectBlender = Get-Process -Id $projectBlenderPid -ErrorAction SilentlyContinue
$expectedBlender = (Resolve-Path -LiteralPath '.tools/blender-4.5.14-windows-x64/blender.exe').Path
if ($projectBlender -and $projectBlender.Path -eq $expectedBlender) {
    Stop-Process -Id $projectBlenderPid
}
```

若已在 Blender 進行新編輯，先儲存再停止程序。
