# Vocaboo

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

## 更新:學測歷屆試題(詞彙題)
- 「學測單字表」也有題目分頁(圖示與 Level 3-5 的練習題本相同,標籤為「歷屆試題」):收錄大考中心 106–115 學年度學測英文第壹部分「詞彙題」第 1–10 題,共 100 題,以學年度分組,作答、錯題重測、進度計算與練習題本相同。
- 資料:`data/gsat_questions.json`,由 `python3 tools/build_gsat_exam.py` 從 `tools/gsat_exam/part1_vocab_106-115.txt`(題目)與 `tools/gsat_exam/official_keys.txt`(官方答案,獨立輸入)產生;兩者答案不符、題號缺漏或空格數不對都會直接報錯。
- 題目來自大考中心公布的試題 PDF;112 學年度各題與 111 第 4 題因 PDF 文字擷取遺失底線,空格位置為依句意補回,請對照原卷抽查。答案單字的中文釋義為自編。
- 新增學年度:在 `part1_vocab_106-115.txt` 加 10 行、在 `official_keys.txt` 加一行官方答案,執行 build 腳本,再把 `sw.js` 的 `VERSION` 加 1。

## 更新:學測單字學習的順序與選擇題(v87–v88)
- 學測單字的新字不再每回隨機洗牌,改為固定順序(單字 id 的雜湊,不存任何資料),字卡/選擇題/拼字走同一個序列;到期字先依到期日,同一天內依此序列。
- 學測的「選擇題」現在有自己的卡片類型 `mcq`(卡片 id:`gsat:<wid>:mcq`)與自己的每日新字額度(`daily.new['gsat:mcq']`),不再與字卡(`recog`)共用,因此字卡做完後選擇題仍可重做同一批字。只新增資料,既有 `recog` / `spell` 卡片與紀錄不變;教材題庫的行為不變。
- 某練法挑新字時,「已在其他練法學過」的字優先(再依固定序列),所以舊進度的學生(字卡當初是隨機挑的)也會重做自己學過的那批。
- 進度數字(已學/精熟/待複習)同時計入字卡與選擇題的卡片。

## 更新:「已學」的定義(v89 學測;v91 起字彙王 Level 3-5 同樣適用)
- 單字的「已學」(學測與字彙王 Level 3-5 相同)改為:該字在**選擇題與拼字都答過**(只用字卡不算);「已精熟」= 已學 且 拼字答對過 且 記憶穩定度 ≥ 21 天(因此精熟必為已學的子集)。首頁「已學 N / 6070」與進度頁共用此定義。只改顯示,不動儲存資料。
