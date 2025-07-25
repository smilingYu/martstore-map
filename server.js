const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// 設置靜態檔案目錄
app.use(express.static(path.join(__dirname)));

// 啟動伺服器
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});