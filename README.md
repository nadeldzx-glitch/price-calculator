# price-calculator
price-calculator

## 部署

GitHub Pages 从 main 分支根目录发布 index.html。
计算、打印和 Excel 导出在浏览器执行。

跨设备共享模板使用 server.mjs 后端，运行环境为 Node.js 22 或以上版本。
启动命令为 node server.mjs，默认端口为 3000。
通过环境变量 ADMIN_PASSWORD 设置管理员密码，DATA_DIRECTORY 设置持久化数据目录，ALLOWED_ORIGINS 设置允许的前端地址。
部署后把 backend-config.js 中的 CALCULATOR_BACKEND_URL 设置为后端 HTTPS 地址。
当前后端地址待配置，页面会明确提示共享模板服务的配置状态。
