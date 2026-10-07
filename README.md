# c2c-005 · 声音表情包工坊

Vue 3 + TypeScript + Vite 纯前端声音创作工具。支持最长 10 秒录音/导入、裁剪、声学特征情绪匹配、Canvas 封面、IndexedDB 本地作品集和系统文件分享。

编辑已保存作品时可选择「更新原作」（保留原身份与创建时间，记录最近修改时间）或「另存副本」（新身份，两件作品可独立修改、删除，同名也可并存）。保存采用"写入 → 点读核对修改时间令牌 → 刷新列表"的顺序：渲染或写入失败保留编辑内容且不宣布成功；写入成功但核对/列表刷新失败时进入未确认态，可一键核对真实结果或重试刷新，重试复用预占身份，不会产生重复副本或误覆盖原作。旧记录缺少修改时间时按创建时间排序，不回填伪造。

## 架构

- `src/core`：作品模型、特征归一化、情绪规则与封面预设
- `src/ports`：录音、音频、Canvas、仓储与分享接口
- `src/adapters`：MediaRecorder、Web Audio、Canvas、IndexedDB、Web Share 实现
- `src/ui`：Vue 阶段式工作流和原生 CSS

## 运行

```bash
npm install
npm run dev
npm run build
docker compose up --build
```

本地开发默认由 Vite 提供；Docker 部署访问 `http://localhost:8105`。浏览器录音在非 localhost 环境通常需要 HTTPS 和麦克风权限。

声音只保存在本机 IndexedDB，不会上传。生成的分享链接仅承载标题、情绪和封面配置，不包含原始音频；文件分享不受此限制。情绪识别是娱乐性启发式结果，不代表身份、性格或医学判断。
