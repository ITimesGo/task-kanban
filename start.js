// 启动器：以干净的 ELECTRON_RUN_AS_NODE 环境启动 Electron
// 环境里若存在 ELECTRON_RUN_AS_NODE=1（本机全局设置），会让 Electron 退化为纯 Node 模式，
// 导致 require('electron').app 为 undefined。这里去掉该变量后以子进程启动主进程。
const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronBin = require('electron'); // 解析到 electron 可执行文件路径
const child = spawn(electronBin, [path.join(__dirname, 'src/main/main.js')], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => process.exit(code == null ? (signal ? 1 : 0) : code));
