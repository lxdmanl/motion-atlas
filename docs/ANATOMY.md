# 右肘動作與解剖依據

本版將相機估計的右肩、右肘、右腕位置轉成右肘屈曲角度，並驅動教學用解剖模型。畫面的肌肉分類來自一般解剖功能；沒有肌電、外力、個人肌肉參數或肌腱張力量測。

## 四個主要肌群

下表整理典型人體的附著位置與主要動作，依據 [OpenStax《Anatomy and Physiology 2e》§11.5：Muscles That Move the Forearm／圖 11.25–11.26](https://openstax.org/books/anatomy-and-physiology-2e/pages/11-5-muscles-of-the-pectoral-girdle-and-upper-limbs)。起點／止點是解剖命名，並非本專案已逐點校準的網格錨點。

| 肌群 | 近端起點（origin） | 遠端止點（insertion） | 本版介紹的功能 |
| --- | --- | --- | --- |
| 肱二頭肌 Biceps brachii | 長頭：肩胛骨盂上結節；短頭：肩胛骨喙突 | 遠端肌腱附著於橈骨粗隆；另有肱二頭肌腱膜延伸至前臂筋膜 | 屈肘、前臂旋後；也跨越肩關節。不能把屈肘全部歸因於它 |
| 肱三頭肌 Triceps brachii | 長頭：肩胛骨盂下結節；外側頭：肱骨後側骨幹；內側頭：橈神經溝遠端的肱骨後側 | 尺骨鷹嘴 | 主要參與伸肘。長頭亦跨越肩關節 |
| 肱肌 Brachialis | 肱骨前面遠端半部，並有內、外側肌間隔附著 | 尺骨粗隆與冠狀突 | 屈肘；位於肱二頭肌深層 |
| 肱橈肌 Brachioradialis | 肱骨外側髁上脊 | 遠端橈骨莖突基部 | 屈肘並協助穩定前臂 |

肱二頭肌兩頭及腱膜細節另參考 [Washington University：Biceps Brachii](https://nervesurgery.wustl.edu/biceps-brachii/)；肱肌遠端半部與尺骨兩處附著另參考 [Washington University：Brachialis](https://nervesurgery.wustl.edu/brachialis/)。本表採用骨性地標，避免只寫「接到前臂」；並未列出每一處筋膜延伸、解剖變異或個別肌束。

## 原始模型 ID 與肌腱示意

| 畫面構造 | 保留的來源 ID |
| --- | --- |
| 肱二頭肌 | `FJ1478`、`FJ1512` |
| 肱三頭肌 | `FJ1477`、`FJ1479`、`FJ1480` |
| 肱肌 | `FJ1486` |
| 肱橈肌 | `FJ1487` |
| 肱骨 | `FJ3368` |
| 橈骨 | `FJ3349` |
| 尺骨 | `FJ3391` |

這些 ID 對應固定版本 human-atlas／BodyParts3D 幾何，並非使用者本人的掃描。部件與重建方式見 [ASSETS.md](ASSETS.md)，模型署名與授權見 [ATTRIBUTION.md](../public/ATTRIBUTION.md)。

`tendon-biceps-distal` 與 `tendon-triceps-distal` 是程式建立的附著路徑示意，分別表示肱二頭肌通往橈骨、肱三頭肌通往尺骨鷹嘴。它們不是來源資料集分割出的肌腱網格；路徑、厚度與形變不能用來估算真實肌腱長度、應變或受力。本版也沒有重現肱二頭肌腱膜或所有肌腱分支。

## 如何解讀動作

- **屈曲角度**：手臂伸直為 0°，彎成直角為 90°。程式取肩—肘與腕—肘向量的夾角，再以 180° 減去該角。右手臂動畫限制為 0–130°；這是展示範圍，不是正常活動度或個人安全範圍判定。
- **動作方向不等於出力肌群**：緩慢放下手持重物時，肘部可以逐漸伸直，而肱二頭肌仍以離心方式控制放下。角度維持不動也可能有等長出力。因此，程式的 `flexing`、`extending`、`holding` 只描述角度變化，不能直接證明哪條肌肉有多大活化。[OpenStax §10.4：肌肉收縮型態](https://openstax.org/books/anatomy-and-physiology-2e/pages/10-4-nervous-system-control-of-muscle-tension)
- **顏色與高亮**：表示選取構造與解剖角色；不是 EMG、肌肉力占比、疲勞或肌腱張力熱圖。
- **資料來源**：展示滑桿／動畫必須標為 `demo`；相機追蹤才是 `camera`。遮擋、低可信度或過期資料不能沿用舊角度回答即時問題。詳細門檻見 [VOICE.md](VOICE.md)。

## 目前驗證範圍

2026-10-04 使用者已在實機回報「角度與模型會隨動」，因此相機到畫面模型的基本連動已有人工確認。尚未以量角器或動作捕捉設備比對誤差，也未取得真人追蹤的定量 FPS／延遲紀錄。這項回報不能驗證肌肉活化、肌腱受力或臨床精度。

語音尚待使用者自行設定 API key 後進行真實連線與十輪驗收；目前不能宣稱語音已通過現場驗證。

文中解剖內容為簡短事實整理與來源連結，未收錄教材原圖或整段教材。OpenStax 教材的使用條件以其官方頁面當前標示為準；模型資產的授權另見上述署名檔。
