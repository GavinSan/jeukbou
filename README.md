# 雀簿

港式台牌即時計分 app：多枱同步入數、拉 / 劈、籌碼、莊番、抽水、龍虎榜同埋數。

網址：<https://jeukbou-app.web.app>

## 功能

- [x] 計分引擎（`src/engine`），45 個測試
- [x] 計分試算頁（`npm run lab` → `lab/dist/scoring-lab.html`）
- [x] 登入（Google、Email）、自訂頭像
- [x] 牌友圈：邀請連結、6 位加入碼、自動加入／要批准／不收新人
- [x] 大局、多枱：枱面即時入數、拉住籌碼、一炮多響、即摸、特別事項、詐糊、流局
- [x] 換人、掉位、擲骰（跟莊家）
- [x] 家規：底、莊、雙三響、拉 / 劈、抽水；每個牌友圈自己嘅番數表（可搜尋、局主編輯）
- [x] 埋數：麻雀數同晚餐等開支分開計、取整（向上／四捨五入／不變）、水由邊個保管、最少轉賬
- [x] Group 一齊計：今晚臨時或者預設（每次自動，冇嚟嘅人唔計）
- [x] 龍虎榜：日／週／月／年、個人統計、走勢圖
- [x] 首頁戰績：場數、勝率、走勢、雀力分、段位、成就
- [x] 匯入 Google Sheet 舊紀錄、對應舊玩家
- [x] 番數表更新提示、系統通知（app 開住時）
- [x] 聲效、震動、高番慶祝動畫
- [ ] App 離線時嘅推送通知
- [ ] App Store / Galaxy Store 版本

## 本機開發

```bash
npm install
cp .env.example .env.local   # 貼返 Firebase 網頁設定
npm run dev
npm test                     # 計分引擎測試
```

示範模式（唔使登入）：`/demo`、`/demo/home`、`/demo/t/0`。

## 推播通知（可選）

app 閂咗都收到約局、三缺一、夠腳、番數表更新同加入申請通知。要：

1. Firebase 轉 Blaze 計劃（用幾多俾幾多；記得喺 Google Cloud 設預算提醒）。
2. Firebase Console → 專案設定 → Cloud Messaging → 網頁推播憑證 → 產生金鑰組；將公開金鑰加做 GitHub **Variable** `FIREBASE_VAPID_KEY`。
3. 畀部署用嘅服務帳戶加權限：Cloud Functions Admin、Service Account User、Artifact Registry Administrator、Cloud Build Editor、Eventarc Admin。
4. GitHub **Variable** `ENABLE_PUSH` = `true`，再 push 上 main（或者手動跑 Deploy）。

程式碼喺 `functions/`；推播 token 存喺 `users/{uid}/pushTokens`。
