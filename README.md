# 學測單字 App

手機優先的 PWA:字卡(FSRS 排程)、選擇題、拼字,分成兩個單字庫:

- **學測 Level 1–6** (`data/gsat.json`)
- **教材單字** (`data/material.json`,老師提供的單字表)

## 本機試用(Windows)
雙擊 `start.bat`,再用瀏覽器開 http://localhost:8000 。
(需要安裝 Python;直接雙擊 index.html 無法載入單字資料。)

## 分享給學生
1. 把整個資料夾(不含 `tools/` 內的原始檔也可以)上傳到 **Cloudflare Pages**(Direct Upload,拖曳資料夾即可)或 GitHub Pages。
2. 把網址貼給學生。iPhone 請「分享 → 加入主畫面」再開始背。
3. 更新單字庫後,請把 `sw.js` 裡的 `VERSION` 加 1(例如 `v2`),學生才會拿到新版。

## 單字資料格式
```json
{ "meta": {"sample": false}, "words": [
  {"id":"s1","w":"apple","pos":"n.","zh":"蘋果","lv":1,"ex":"I eat an apple.","exzh":"我吃一顆蘋果。"}
]}
```
- `w`:英文(`bicycle/bike` 表示兩種拼法都算對)
- `lv`:學測等級 1–6(僅 gsat.json)
- `list`:單元名稱(僅 material.json,例如 "Unit 1")
- `meta.sample` 設為 `false` 即可隱藏「示範資料」提示。

## 授權與致謝
詞彙等級:大考中心《高中英文參考詞彙表》(非營利使用,須標示出處)。
釋義:ECDICT(MIT)。例句:Tatoeba(CC BY 2.0 FR)或自編。排程:ts-fsrs(MIT)。

---

## 更新:練習題本模式、錯題本、完整詞庫

- **練習題本**分頁:照教材 Unit 1–60 的原題(文意字彙 / 選擇題 / 配合題)作答;答錯自動進「錯題本」,可針對錯題重考(選項會重新排列),「進度」分頁顯示答對題數 / 總題數(目前 1,200 題)。
- 資料產生:
  - `python3 tools/build_material.py` — 由 `tools/units/uNN.txt` 產生 `data/questions.json`、`data/material.json`。
  - `python3 tools/build_gsat.py <ceec_entries.json> <stardict.db>` — 由大考中心詞彙表(`tools/parse_ceec.py` 解析)+ ECDICT 產生 `data/gsat.json`(6,070 字)與 `tools/gsat_review.csv`(供校對)。個別修正可寫在 `tools/zh_overrides.json`。
- 題目為教材照片轉錄,**答案與中文釋義已與教材官方解答(`tools/answers_all.txt`,由解答頁照片轉錄)逐題核對**:`python3 tools/compare_answers.py` 可重新比對,`build_material.py` 若發現答案與官方解答不同會直接報錯。題目文字(照片轉錄)仍可能有零星抄寫誤差,見 `tools/CHECKLIST_uncertain.md`。
- 改動任何檔案後,請把 `sw.js` 的 `VERSION` 加 1,學生才會拿到新版。
- 備份檔現已包含練習題本作答紀錄。
