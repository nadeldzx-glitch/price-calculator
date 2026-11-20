# price-calculator
price-calculator

## 部署

GitHub Actions 从 main 分支发布计算器和 shared-template.json。
计算、打印和 Excel 导出在浏览器执行。

## 共享模板

管理员在计算器的“管理员登录”中填写 GitHub fine-grained personal access token。
创建令牌时，只选择 price-calculator 仓库，Repository permissions 中的 Contents 设为 Read and write。
令牌保存在当前标签页的 sessionStorage 中，退出管理员时清除。

“存为模板”会将配置提交到本仓库的 shared-template.json，并自动触发 Pages 发布。
普通使用者刷新时会载入共享模板。页面打开期间，每分钟和切回页面时检查更新，点击“立即同步”后应用。
并发发布会校验模板版本及 GitHub 文件 SHA，避免覆盖其他管理员的新版本。

首次发布前 shared-template.json 为空，使用计算器原有默认值和浏览器已保存配置。
