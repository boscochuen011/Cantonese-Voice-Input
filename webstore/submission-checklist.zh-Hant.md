# Chrome Web Store 上架清單（繁中）

## 重要限制
- 無法由程式「自動代你完成上架送審」。
- 原因：開發者帳號註冊、付款、2-Step Verification、條款同意、最終送審都必須由帳號持有人在 Web Store 後台手動完成。

## 你已可直接使用的素材
- 上架文案：`webstore/listing-copy.zh-Hant.md`
- 權限與資料使用說明：`webstore/permission-and-data-disclosure.zh-Hant.md`
- 私隱政策範本：`webstore/privacy-policy.zh-Hant.md`
- 截圖：`webstore/screenshots/01-setup-wizard.png`、`webstore/screenshots/02-side-panel.png`、`webstore/screenshots/03-input-demo.png`

## 送審前檢查
1. `manifest.json` 的 `name`、`description`、`version` 已確認。
2. 所有 icon 正常：`icons/icon-16.png`、`icons/icon-32.png`、`icons/icon-48.png`、`icons/icon-128.png`。
3. 功能測試完成：
   - 網頁輸入欄可用。
   - `Control` 連按兩下可啟動。
   - 主介面或無輸入欄位會有提示，不會誤插入。
4. 已準備好支援電郵與私隱政策網址（若未有網站，可先放 GitHub Pages）。

## Dashboard 提交流程
1. 開啟 Chrome Web Store Developer Dashboard：<https://chrome.google.com/webstore/devconsole>
2. Upload 新版本 zip（見下方打包指令）。
3. 填寫 Store listing（可直接複製 `webstore/listing-copy.zh-Hant.md`）。
4. 上傳至少 1 張截圖（建議 3 張）。
5. 填寫 Data usage / Privacy 欄位（可參考 `webstore/permission-and-data-disclosure.zh-Hant.md`）。
6. 送出審核。

## 打包指令（PowerShell）
```powershell
$output = "release-package.zip"
if (Test-Path $output) { Remove-Item $output -Force }
$exclude = @(".git", "webstore", "README.md")
$files = Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path $files.FullName -DestinationPath $output
Write-Output "Created $output"
```
