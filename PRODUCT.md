# Product

## Register

product

## Platform

web

## Users

一位使用者，在手機或電腦看到值得留下的網址時，希望立刻收進同一個地方；日後只需搜尋、重看，或讓 AI 讀取已整理好的內容，不想維護伺服器、分類系統或複雜知識庫。

## Product Purpose

把網址轉成可保存、可搜尋、可直接供 AI 取用的乾淨資訊物件。成功代表使用者能在幾秒內完成投遞，清楚知道擷取是否成功，能以精確搜尋找回內容，也能讓 ChatGPT 對整座資料庫做附引用的語意問答。

## Positioning

一個只做兩件事的私人資訊中轉站：收下網址，交出乾淨內容。

## Brand Personality

簡約、安靜、可靠。介面像一張整理得宜的工作桌，讓內容本身成為主角；文案直接、友善，不使用技術術語製造負擔。

## Anti-references

不做塞滿模組的管理儀表板，不做複雜側邊欄與分類樹，不放 AI 聊天窗，不以大量卡片、漸層、玻璃效果或裝飾性動畫假裝功能豐富。

## Design Principles

- 收件優先：貼網址是每次打開時最容易找到、最快完成的動作。
- 狀態誠實：成功、處理中、需要重試與擷取失敗都有清楚且可行動的說明。
- 內容優先：列表先呈現標題、來源與有用摘錄，不用介面裝飾搶走注意力。
- AI 可取用但不打擾：MCP、Markdown 與 JSON 都收在「連接 AI」的次要流程，不佔用主要工作區。
- Sites 主體：D1 與 R2 負責保存、精確搜尋與持久向量索引，不依賴額外 Worker、Vectorize、外部資料庫或 Google Sheet；只有 embedding 與回答會呼叫 Gemini API。

## AI Connection

- 同一個 Site 提供唯讀 Streamable HTTP MCP；`search_library` 做精確搜尋，`ask_library` 做跨資料語意問答，`read_bookmark` 分段讀取單筆內容，`list_recent_bookmarks` 列出近期收藏。
- AI 只會取回相關搜尋結果或片段，不會一次載入整座資料庫；語意答案必須附上可核對的收藏引用，索引不完整時要明確揭露。
- 支援 OAuth 的 AI 會開啟 Site 授權頁，沿用 owner 的 ChatGPT 登入完成同意；SIWC session 本身不會交給 MCP client。
- 不支援 OAuth 的 Agent 可以使用獨立、可撤銷、只顯示一次的唯讀 Bearer 金鑰；手機收件金鑰永遠不能讀取資料。
- 擷取到的 R2 Markdown 是原始來源；D1 分段與 FTS5 是可重建的精確搜尋鏡像。
- Gemini Embedding 2 產生可持續重用的向量並保存在 D1；D1 追蹤收藏與內容版本，內容更新與刪除都要同步處理。
- `GEMINI_API_KEY` 只可存成 Sites 的 server-side Secret，不可由網頁輸入、寫入瀏覽器儲存空間、公開程式碼、MCP 回應或資料庫。
- 未設定 `GEMINI_API_KEY` 時，擷取、精確搜尋、匯出與原有 MCP 讀取功能仍須正常；介面把語意索引誠實顯示為「等待安全設定」。

## Search & Retrieval

- 精確層：D1 FTS5 針對標題、來源、作者、段落標題與正文建立全文索引並依相關性排序，適合名稱、關鍵字與已知來源查找。
- 語意層：Gemini Embedding 2＋D1 cosine 排序適合概念、換句話說與跨收藏綜合；持久向量避免每次問答重新處理全部內容。
- 引用層：語意結果必須映射回本地收藏與同一內容版本；沒有有效引用或引用已過期時，不提供看似確定的答案。
- 漸進層：既有收藏可分批補索引，新收藏自動排入；索引未完成不阻塞精確搜尋，並向使用者與 MCP client 揭露完整度。

## Accessibility & Inclusion

以 WCAG AA 為基準，正文與控制項維持清楚對比；完整支援鍵盤與可見焦點；觸控目標適合手機；狀態不只依賴顏色；所有非必要動畫尊重 reduced-motion 設定。
