# Chrome Web Store 上架清單（繁中）

## 先講清楚
- 我可以幫你準備所有素材與文件，但無法代你「自動按鍵送審」。
- 原因：登入、付款、2-step verification、同意條款、最終送審都必須由你本人在官方後台完成。

## 已準備素材
- Store 文案：`webstore/listing-copy.zh-Hant.md`
- 權限與資料披露草稿：`webstore/permission-and-data-disclosure.zh-Hant.md`
- 私隱政策範本：`webstore/privacy-policy.zh-Hant.md`
- 截圖：`webstore/screenshots/01-setup-wizard.png`、`webstore/screenshots/02-side-panel.png`、`webstore/screenshots/03-input-demo.png`

## 上架步驟
1. 開 Developer Dashboard：<https://chrome.google.com/webstore/devconsole>
2. 上傳 extension zip（根目錄需有 `manifest.json`）
3. 填 Store listing（可直接用文案檔）
4. 上傳截圖（至少 1 張，建議 3 張）
5. 填 Data usage / Privacy 欄位
6. Submit for review

## 打包指令（PowerShell）
```powershell
$output = "release-package.zip"
if (Test-Path $output) { Remove-Item $output -Force }
$exclude = @(".git", "webstore", "README.md")
$files = Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path $files.FullName -DestinationPath $output
Write-Output "Created $output"
```
