#!/usr/bin/env node
// req-cli：把华为云 CodeArts 需求管理「创建工作项」API 封装成命令行工具。
import { main } from './lib/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
