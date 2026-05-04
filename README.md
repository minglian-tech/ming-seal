# 铭印 MingSeal

<div align="center">

**AI Agent 司法存证工具**

将 AI Agent 的对话、决策、动作通过 Merkle 聚合 + OP_RETURN 锚定到链上，生成不可篡改的存证证书

[![npm version](https://img.shields.io/npm/v/@mingchain/ming-seal.svg)](https://www.npmjs.com/package/@mingchain/ming-seal)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 核心功能

### 🔐 文本对话存证
自动/手动将 AI 对话内容 SHA-256 哈希后上链，生成司法级证据链

### 🖼️ 图片存证
支持图片哈希上链，原始图片可本地存储，链上验证完整性

### 🌳 Merkle 批量聚合
默认 100 条/批次，显著降低单条存证成本

### ⛓️ OP_RETURN 链上锚定
将 Merkle 根写入 BSV 区块链，永久不可篡改

### 🔄 离线队列
网络异常时本地缓存，恢复后自动补上，零丢失

### 🛡️ 数据脱敏
敏感信息（手机号、邮箱、身份证等）不进入哈希计算，保护隐私

### 📜 存证证书生成
自动生成 HTML 格式证书，包含 TxID、哈希、时间戳等完整信息

### ✅ SPV 轻验证
无需运行全节点，即可验证链上存证的完整性

---

## 架构图

```
┌─────────────┐    ┌───────────┐    ┌────────────┐    ┌─────────────────┐
│   数据输入   │───▶│  数据脱敏  │───▶│ SHA-256哈希 │───▶│ Merkle 批量聚合 │
└─────────────┘    └───────────┘    └────────────┘    └────────┬────────┘
                                                                  │
                                                                  ▼
┌─────────────┐    ┌───────────┐    ┌────────────┐    ┌─────────────────┐
│  存证证书    │◀───│  SPV验证   │◀───│  链上锚定   │◀───│ BSV OP_RETURN  │
│  (HTML)     │    │           │    │            │    │                 │
└─────────────┘    └───────────┘    └────────────┘    └─────────────────┘
```

---

## 安装

```bash
npm install @mingchain/ming-seal
```

---

## 快速上手

### 1. 配置钱包

创建 `wallet.json` 文件（注意：此文件包含私钥，请妥善保管，切勿提交到代码仓库）：

```json
{
  "bsvWif": "your-bsv-private-key-in-wif-format"
}
```

或通过环境变量配置：

```bash
export MINGSEAL_BSV_WIF="your-bsv-private-key-in-wif-format"
```

### 2. 基础使用

```javascript
const MingSeal = require('@mingchain/ming-seal');

// 初始化
const seal = new MingSeal({
  bsvWif: process.env.MINGSEAL_BSV_WIF,
  batchSize: 100
});

// 存证文本
await seal.attest({
  type: 'conversation',
  content: '用户询问股票代码...'
});

// 存证图片哈希
await seal.attest({
  type: 'image',
  hash: 'sha256:abc123...',
  metadata: { filename: 'report.pdf' }
});

// 获取存证证书
const certificate = await seal.getCertificate('MS20260503-001');
console.log(certificate);
```

### 3. OpenClaw 插件使用

```javascript
// 在 OpenClaw 插件中加载
const seal = require('@mingchain/ming-seal');

// 注册为插件
api.registerPlugin(seal, {
  enabled: true,
  autoAttest: true,  // 对话结束自动存证
  batchSize: 100
});
```

---

## API 文档

### `MingSeal`

主类，提供所有存证功能。

#### 构造函数

```javascript
new MingSeal(options)
```

**参数：**

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `bsvWif` | string | 环境变量 | BSV 钱包私钥（WIF 格式） |
| `batchSize` | number | 100 | Merkle 批量聚合条数 |
| `network` | string | 'mainnet' | BSV 网络 |
| `workspaceDir` | string | 'ming-seal-records' | 本地存储目录 |
| `autoSign` | boolean | true | 自动签名交易 |

#### 方法

##### `attest(data)`

存证一条数据

```javascript
await seal.attest({
  type: 'conversation' | 'action' | 'image' | 'custom',
  content: string,
  metadata?: object
})
```

##### `getCertificate(id)`

获取存证证书

```javascript
await seal.getCertificate('MS20260503-001')
```

##### `verify(txid)`

验证链上存证

```javascript
await seal.verify('txid-or-attestation-id')
```

##### `getStatus()`

获取队列状态

```javascript
await seal.getStatus()
// 返回: { pending: 5, constructed: 2, signed: 1, anchored: 100 }
```

---

## 配置说明

### 钱包配置

| 配置方式 | 优先级 | 说明 |
|---------|--------|------|
| 构造函数参数 | 1 | 最高优先级 |
| 环境变量 `MINGSEAL_BSV_WIF` | 2 | 次优先级 |
| wallet.json 文件 | 3 | 默认查找当前目录 |

### 脱敏规则

默认脱敏的敏感字段：

- 手机号: `138****1234`
- 邮箱: `u***@domain.com`
- 身份证: `3***********1234`
- 银行卡: `****1234`
- API 密钥、Token 等

自定义脱敏规则可通过 `sanitizeRules` 配置项添加。

---

## 与铭链科技产品协同

<div align="center">

| 产品 | 功能 | 定位 |
|------|------|------|
| **铭鉴** (bsv-geo-shield) | 数据溯源防投毒 | 数据层 |
| **铭印** (ming-seal) | 动作存证可追溯 | 行为层 |
| **铭志** (bsv-hilog) | 日志防篡改 | 日志层 |

**合在一起：从数据到动作，全链路信任**

</div>

---

## 技术规格

### 协议格式

```
MSLL v1.0
├── 协议标识: 0x4D534C4C (MSLL)
├── 版本: 0x01
├── Merkle根: 32字节
├── 批次ID: 8字节时间戳
└── 记录数: 2字节
```

### OP_RETURN 大小

约 45 字节，远低于 BSV OP_RETURN 100KB 限制

### 存储

- 链上：Merkle 根 + 协议元数据
- 链下：原始数据哈希、证书、交易详情

---

## 状态说明

| 状态 | 说明 |
|------|------|
| `pending` | 待处理 |
| `constructed` | 交易已构造 |
| `signed` | 交易已签名 |
| `anchored` | 已上链锚定 |
| `failed` | 失败 |

---

## 文件结构

```
ming-seal/
├── index.js                 # 主入口
├── lib/
│   ├── merkle.js            # Merkle 树构建与验证
│   ├── sanitizer.js         # 数据脱敏
│   ├── bsv-anchor.js        # BSV OP_RETURN 交易构造与签名
│   ├── receipt.js           # 存证收据生成
│   ├── certificate.js      # 证书生成
│   └── image-hash.js       # 图片哈希计算
├── skills/
│   └── ming-seal.md        # OpenClaw 技能描述
├── templates/
│   └── certificate.html    # 存证证书 HTML 模板
├── openclaw.plugin.json    # OpenClaw 插件配置
├── package.json
└── README.md
```

---

## 开源协议

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 免责声明

本工具生成的存证为技术存证凭证，实际法律效力取决于司法管辖区的相关规定。开发者和铭链科技不对存证的法律效力做任何承诺或保证。

---

## 联系方式

- **GitHub**: https://github.com/minglian-tech/ming-seal
- **npm**: https://www.npmjs.com/package/@mingchain/ming-seal
- **铭链科技**: https://mingchain.tech
