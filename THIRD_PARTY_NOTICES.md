# 新增第三方素材

Kenney Cube Pets · Kenney · CC0 1.0 Universal
https://kenney.nl/assets/cube-pets
https://creativecommons.org/publicdomain/zero/1.0/

新增24種動物，保留全部8段原生動畫，原授權位於assets/licenses/Kenney_CubePets/License.txt。此版本只將色票PNG內嵌到GLB，不重新製作動物外觀。署名為自願保留來源，不暗示Kenney替此遊戲背書。

Three.js採MIT授權，見vendor/THREE-LICENSE.txt。既有素材來源與授權維持原套件紀錄。

## v7 地表與景觀

v7 的草地顏色、短草幾何、河道、田區與隧道山坡由本專案程式產生，未加入網路照片、草皮圖片或其他第三方下載素材。既有 Kenney 動物與原有素材的授權註記保留。新地形參考圖僅用於理解需求，未打包為遊戲素材。

## v8 自然模型與物理引擎

**Quaternius Ultimate Stylized Nature Pack（May 2022）**：Quaternius，63 款，特定版本依作者專屬作品頁的 CC0 1.0 聲明使用。作者頁 https://quaternius.com/packs/ultimatestylizednature.html 。原授權、查核、通用授權頁差異與貼圖取得紀錄見 `assets/licenses/Quaternius_UltimateStylizedNature_202205/`；逐模型出處及衍生資訊見 `assets/provenance/Quaternius_UltimateStylizedNature_202205/`。遊戲主模型提取重複貼圖並新增部分 LOD；不將第三方模型宣稱為原創。

**Rapier @dimforge/rapier3d-compat 0.21.0**：Dimforge，Apache-2.0。完整原文見 `vendor/rapier/LICENSE`，固定版本、官方 registry tarball、SHA-512 與本機 SHA-256 見 `vendor/rapier/version.json`。ESM 內嵌 WASM，執行時不需外部下載。引擎原始碼 https://github.com/dimforge/rapier ，文件 https://rapier.rs/ 。此授權與素材的 CC0 分別適用。

## v11 渦輪

遊戲使用 GameAssets 收錄的 `Prop_Aircraft_TurbofanExterior_LowPoly_001.glb`。模型衍生自 Innerscene 發布的 CC0 1.0 Turbofan Exterior Assembly，包含 8,612 個三角形和旋轉扇葉動畫。來源紀錄與授權全文收在 `assets/licenses/Innerscene_Turbofan/`。 [Innerscene 原始模型](https://www.innerscene.com/tools/library/3d-parts/turbofan-exterior-assembly-f68ba851)

## v18 音效

**Kenney Interface Sounds 1.0**，Kenney，CC0 1.0 Universal。來源檔為作者在 OpenGameArt 發布的版本。選用的音效轉成單聲道 WAV 供瀏覽器播放。 [Kenney 原始素材頁](https://kenney.nl/assets/interface-sounds) · [OpenGameArt 發布頁](https://opengameart.org/content/interface-sounds)

| 遊戲用途 | 原檔 | 專案檔 |
| --- | --- | --- |
| 答對 | `confirmation_001.ogg` | `correct.wav` |
| 答錯 | `error_001.ogg` | `wrong.wav` |
| 加速星星抵達 | `pluck_001.ogg` | `charge.wav` |
| 出發 | `confirmation_003.ogg` | `depart.wav` |
| 個人完賽 | `confirmation_002.ogg` | `finish.wav` |

原作者的授權註記收錄於 `assets/licenses/Kenney_InterfaceSounds/License.txt`。

## v19 背景配樂

以下 8 首均使用來源頁上以 CC0 1.0 Universal 發布的版本。音訊轉成 112 kbps 立體聲 MP3，並調整音量以便遊戲播放。 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)

| 曲目 | 作者 | 風格 | 原檔 | 專案檔 |
| --- | --- | --- | --- | --- |
| [Racing Game Menu](https://opengameart.org/content/racing-game-menu) | MintoDog | 競速電子 · 165 BPM | `racing_game_menu_bpm165.mp3` | `racing-game-menu.mp3` |
| [Super Wreck Roadway](https://opengameart.org/content/super-wreck-roadway) | Umplix | 追逐搖滾 | `super_wreck_roadway_loop.wav` | `super-wreck-roadway.mp3` |
| [Hyper Ultra-Racing](https://opengameart.org/content/hyper-ultra-racing) | cynicmusic | 高速鼓打貝斯 | `AugustUltraAmbience.wav` | `hyper-ultra-racing.mp3` |
| [Hyperflight Racing](https://opengameart.org/content/hyperflight-racing) | cynicmusic | 競速迷幻電子 | `2012_november_fakeAwake04 back to A minor.wav` | `hyperflight-racing.mp3` |
| [Tech Rave (Faster)](https://opengameart.org/content/tech-rave) | Frenchyboy | 快版 Techno | `TechRaveFaster.wav` | `tech-rave-faster.mp3` |
| [Determined Pursuit](https://opengameart.org/content/determined-pursuit-epic-orchestra-loop) | Emma_MA | 管弦追逐 | `determined_pursuit_loop.wav` | `determined-pursuit.mp3` |
| [Battle RPG Theme](https://opengameart.org/content/boss-battle-theme) | Cleyton Kauffman | 戰鬥搖滾與管弦 | `CleytonRX - Battle RPG Theme_1.mp3` | `battle-rpg-theme.mp3` |
| [Retro Game Music Pack · Level 3](https://opengameart.org/content/5-chiptunes-action) | Juhani Junkala (SubspaceAudio) | 街機動作 | `Juhani Junkala [Retro Game Music Pack] Level 3.wav` | `retro-level-3.mp3` |

## v20 實況攝影無人機

**Quadcopter with flight electronics**，Innerscene，CC0 1.0 Universal。遊戲版以 Blender 簡化為 822 個三角面，保留四組獨立旋轉的槳葉和可轉向鏡頭。外殼改為淺色並標上橘色馬達環。 [原始模型與授權](https://www.innerscene.com/tools/library/3d-parts/quadcopter-with-flight-electronics-a25968c1)

原檔 quadcopter-original.glb 的 SHA-256 為 24d1ac5804afea4076df2b4bc65ce780764d01619eb5fc08900480471cc43a0d。 [原始 GLB](https://files.innerscene.com/library/quadcopter-with-flight-electronics-a25968c1/7bbe389047145edeb575/quadcopter-original.glb)
