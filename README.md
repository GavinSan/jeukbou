# 雀簿

港式台牌即時計分 app：多枱同步入數、拉 / 劈、籌碼、莊番、抽水、龍虎榜同埋數。

而家嘅進度：

- [x] 計分引擎（`src/engine`），37 個測試
- [x] 計分試算頁（`npm run lab` → `lab/dist/scoring-lab.html`）
- [x] 登入（Google、Email）
- [ ] 牌友圈、大局、邀請連結
- [ ] 枱面即時入數、拉住籌碼
- [ ] 換位、埋數、開支、龍虎榜

## 本機開發

```bash
npm install
cp .env.example .env.local   # 貼返 Firebase 網頁設定
npm run dev
npm test                     # 計分引擎測試
```

## 部署

push 上 `main` 就會由 GitHub Actions 自動 build 同部署去 Firebase Hosting，連埋 `firestore.rules`。第一次要喺 GitHub repo 嘅 **Settings → Secrets and variables → Actions** 加兩樣嘢：

| 種類 | 名 | 內容 |
| --- | --- | --- |
| Variable | `FIREBASE_WEB_CONFIG` | Firebase 網頁設定，成段 JSON |
| Secret | `FIREBASE_SERVICE_ACCOUNT` | Firebase 服務帳戶私密金鑰（JSON） |

## 安全

- Firebase 網頁設定（`apiKey` 嗰啲）唔係密碼，網站上線之後任何人都睇到；資料靠 `firestore.rules` 同 `storage.rules` 保護。
- 服務帳戶金鑰係真正嘅鎖匙，只可以放喺 GitHub Secret，永遠唔好 commit。`.gitignore` 已經擋住常見嘅檔名。
- 建議喺 Google Cloud 主控台將網頁 API key 限制為只准 `jeukbou-app.web.app`、`jeukbou-app.firebaseapp.com` 同 `localhost` 使用。
