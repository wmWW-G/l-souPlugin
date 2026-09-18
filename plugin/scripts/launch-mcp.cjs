'use strict';
// Accio 管理的 Node 仅承载轻量 MCP 入口；Tauri 启动的业务后端使用 ZIP 内的固定 Node。
// 保持同一 MCP 进程，Accio 关闭 stdin/终止会话时不会遗留额外代理进程。
require('./desktop-mcp.cjs');
