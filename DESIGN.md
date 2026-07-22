---
name: 中轉站
description: 一張安靜的私人收件桌，收下網址並交出乾淨內容。
colors:
  background: "oklch(1 0 0)"
  surface: "oklch(0.975 0.004 250)"
  surface-strong: "oklch(0.945 0.008 250)"
  ink: "oklch(0.19 0.016 250)"
  muted: "oklch(0.43 0.025 250)"
  faint: "oklch(0.58 0.018 250)"
  border: "oklch(0.87 0.012 250)"
  border-strong: "oklch(0.76 0.022 250)"
  primary: "oklch(0.4 0.11 250)"
  primary-hover: "oklch(0.34 0.12 250)"
  primary-soft: "oklch(0.94 0.025 250)"
  focus: "oklch(0.7 0.14 250)"
  success: "oklch(0.43 0.115 154)"
  warning: "oklch(0.47 0.105 78)"
  danger: "oklch(0.46 0.15 27)"
  backdrop: "oklch(0.09 0.016 250 / 0.68)"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 720
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1rem"
    fontWeight: 680
    lineHeight: 1.38
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  action:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "normal"
  control:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "normal"
  support:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  subheading:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 720
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  caption:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  micro:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "normal"
  symbol:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  symbolLarge:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  mobileDisplay:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif"
    fontSize: "1.9rem"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
rounded:
  xs: "4px"
  mark: "7px"
  sm: "8px"
  thumbnailCompact: "9px"
  field: "10px"
  control: "11px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "50px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: "38px"
  capture-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "7px"
    height: "66px"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 13px"
    height: "44px"
  filter-chip:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
    height: "36px"
  bookmark-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "0"
    padding: "20px 10px"
  bookmark-thumbnail:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "11px"
    width: "86px"
    height: "56px"
  status-ready:
    backgroundColor: "transparent"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.background}"
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "11px 15px"
---

# Design System: 中轉站

## Overview

**Creative North Star: "安靜的收件桌"**

中轉站像一張整理得宜的私人工作桌：打開就看到收件處，視線接著落到過去留下的內容。單欄、寬留白與低彩度表面降低認知負擔，只讓深鈷靛在主要動作與正在處理的狀態出聲。

介面以熟悉而可預測的產品操作為優先：輸入框就是輸入框，書籤以清楚分隔線排成列表；點擊條目後，以接近全畫面的專注閱讀浮層呈現完整正文與資訊。系統不靠裝飾營造能力感，而是靠清楚狀態、穩定節奏與可取用的內容取得信任。

**Key Characteristics:**

- 單欄主線，桌面最寬 960px，手機在 680px 改為垂直操作。
- 低彩度中性色為底，單一深鈷靛點出主要動作。
- 內容列表取代卡片網格，用分隔線而非陰影組織層次。
- 完整的深色模式、鍵盤焦點與 reduced-motion 保護。

## Colors

色彩策略是「節制」：中性表面承擔結構，深鈷靛只承擔行動、焦點與處理中狀態。

### Primary

- **深鈷靛** (`colors.primary`)：「收進來」、字標、焦點與處理中提示；懸停時只加深一階。
- **鈷靛薄霧** (`colors.primary-soft`)：僅用於輸入聚焦環與選取背景，不得成為大面積裝飾。

### Neutral

- **淨白桌面** (`colors.background`)：頁面與主要控制項的底色。
- **冷灰表面** (`colors.surface`, `colors.surface-strong`)：搜尋、懸停與展開列的輕微層次。
- **深墨** (`colors.ink`)：主標題、正文與選中篩選項。
- **靜灰** (`colors.muted`, `colors.faint`)：輔助文字、時間與 placeholder；層級由實際重要性決定。
- **結構線** (`colors.border`, `colors.border-strong`)：列表、頂列與輸入區邊界。

### Semantic

- **完成綠** (`colors.success`)：已完成狀態。
- **注意琥珀** (`colors.warning`)：部分完成、可重試狀態。
- **行動紅** (`colors.danger`)：擷取失敗、錯誤與刪除確認。
- **專注遮罩** (`colors.backdrop`)：只在收藏詳情開啟時降低背景干擾，不承擔品牌或狀態意義。

**The One Accent Rule.** 深鈷靛不超過單一畫面的 10%；它的稀少就是層級。

## Typography

**Display Font:** 系統無襯線（`system-ui`，以 `Noto Sans TC` 作中文後備）  
**Body Font:** 同一組系統無襯線  
**Label Font:** 同一組系統無襯線

**Character:** 單一字族保持工具的安靜與熟悉；層級來自尺寸、字重和留白，不來自裝飾字體。

### Hierarchy

- **Display** (`typography.display`)：只用於「現在想留下什麼？」，上限 16ch，並使用平衡換行。
- **Headline** (`typography.headline`)：資料庫區段標題。
- **Title** (`typography.title`)：書籤標題，最多兩行，將內容重要性放在來源與狀態之上。
- **Body** (`typography.body`)：全局正文，長說明最寬 68ch。
- **Action** (`typography.action`)：首要提交按鈕，保持 16px 可讀尺寸與 700 字重。
- **Control** (`typography.control`)：安靜按鈕與搜尋控制，用 14px 維持密度。
- **Label** (`typography.label`)：按鈕、篩選、狀態與細節標籤，不使用全大寫或寬字距。
- **Subheading / Lead / Support**：1.35rem 與 18px 建立面板內的次層標題與引導文字，15px 用於緊湊說明。
- **Caption / Micro**：12px 與 11px 只用於 meta、時間及極次要標籤。
- **Symbol / Symbol Large / Mono**：24–26px symbol 只承擔方向與關閉符號；12px 等寬字只顯示網址、金鑰與技術值。

**The Workbench Type Rule.** 介面不得在標籤、按鈕或資料中引入展示字體；一組系統字族負責全部任務。

## Elevation

系統預設完全平面化。層次由表面明度、1px 邊界與間距表達；只有浮動通知與使用者主動開啟的詳情浮層離開文件流，因此各允許一個擴散陰影。焦點環是可用性狀態，不是裝飾高度。

### Shadow Vocabulary

- **Toast ambient** (`--shadow-toast`)：只用於頁面右下的短暫回饋；其他容器不得借用。
- **Detail dialog** (`--shadow-dialog`)：只用於條目詳情浮層，搭配單色半透明背景遮罩。

**The Flat-by-Default Rule.** 所有內容列與表單在靜止狀態不使用陰影；詳情浮層只允許一層，不可在裡面再堆浮起卡片。

## Components

### Buttons

- **Shape:** 主按鈕穩固而緊湊（`rounded.control`），次要按鈕較輕（`rounded.sm`）；所有觸控按鈕至少 38px 高。
- **Primary:** 深鈷靛底配淨白字，高 50px，只給收錄動作。
- **Hover / Focus:** 懸停只改變底色，按下下移 1px；鍵盤焦點始終是 3px 可見外框。
- **Quiet / Detail:** 透明或淨白底，以邊界和表面變化回饋；刪除只在確認步驟轉為紅色實心。

### Inputs / Fields

- **Capture field:** 一個 66px 高的水平收件區（`rounded.lg`），輸入與主按鈕共用邊界；在 680px 以下轉為上下堆疊。
- **Search field:** 冷灰表面、44px 高、最寬 320px；手機擴為整行。
- **Focus:** 邊界轉為主色，加上柔和的鈷靛聚焦環；不得移除 outline 而沒有等價提示。

### Chips

- **Filter:** 膠囊形狀（`rounded.pill`）與 1px 邊界；未選時低彩度，選中時深墨底配淨白字。
- **Status:** 小色點加文字，因此狀態不只依賴顏色。

### Cards / Containers

- **Bookmark row:** 不是獨立卡片；以上下 1px 分隔線、20px 垂直留白與懸停表面組成連續列表。左側用 86×56 的內容預覽圖，手機縮為 64×44；沒有內容圖時才退回 favicon 或來源首字。
- **Bookmark detail dialog:** 使用原生 modal dialog 與焦點管理；桌面接近全畫面，左側是 16:9 預覽、標題、摘要與完整正文，右側以 320px 資訊欄呈現來源、狀態、作者、時間、語言、類型、字數與操作。左右可各自捲動，資訊欄只用表面明度與 1px 分隔線，不做巢狀卡片。
- **Dialog responsive behavior:** 800px 以下改為單一文件流；680px 以下佔滿 viewport 並移除圓角，正文在前、資訊接續於後，關閉與操作目標至少 44×44px。
- **Toast:** 固定於右下，最寬 360px，僅在複製、新增與刪除完成後短暫出現。

### Navigation

- **Top bar:** 只保留字標、「連接 AI」與「靜默收藏」，高度 74px；手機收為 64px。
- **Responsive behavior:** 不引入側邊欄或漢堡選單；頁面只有一條主線。

### AI connection panel

- 與靜默收藏設定共用同一個就地展開區域，不另開設定頁或 modal。
- 先呈現推薦的 ChatGPT 登入式 OAuth 連線，再把 Bearer 金鑰收進可展開的備用區。
- 明確標示唯讀權限、索引準備進度與已核准連線；停用採二次確認。
- MCP 網址與安裝指令可以一鍵複製，但任何金鑰明文只顯示一次。

## Do's and Don'ts

### Do:

- **Do** 把貼網址放在首屏最清楚的位置，並維持 50px 主操作高度。
- **Do** 用文字加色點呈現完成、部分完成、擷取中與失敗，狀態不得只依賴顏色。
- **Do** 使用 1px 分隔線、表面明度與留白組織資訊，讓標題、來源和摘錄成為主角。
- **Do** 優先顯示貼文或文章內容圖；預覽失效時依序退回原始 OG、favicon 與來源首字。
- **Do** 在 680px 以下堆疊收件輸入與搜尋，並把詳情浮層改為全畫面單欄；浮層內保留至少 44px 的觸控目標。
- **Do** 對所有狀態轉換套用 reduced-motion 替代，並維持可見的鍵盤焦點。

### Don't:

- **Don't** 「做塞滿模組的管理儀表板」；詳情浮層只服務單筆收藏的閱讀與操作，不得演變成第二個儀表板。
- **Don't** 「做複雜側邊欄與分類樹」；保留單欄收件與搜尋流程。
- **Don't** 「放 AI 聊天窗」；AI 能力透過唯讀 MCP、Markdown 與 JSON 資料出口存在。
- **Don't** 「以大量卡片、漸層、玻璃效果或裝飾性動畫假裝功能豐富」；任何裝飾都必須傳達真實狀態。
- **Don't** 使用彩色側條、漸層字、裝飾性玻璃卡、自訂滾動條或非標準表單控制項。
- **Don't** 把紅、綠、琥珀當裝飾色；它們只能出現在對應的語意狀態。
