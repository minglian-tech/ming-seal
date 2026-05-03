/**
 * 存证收据模块 - MingSeal
 * 生成包含TxID、哈希、时间戳的存证收据
 */

/**
 * 生成存证编号
 * @param {number} sequence - 序号
 * @returns {string}
 */
function generateAttestId(sequence) {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(sequence).padStart(4, '0');
  return `MS${dateStr}-${seq}`;
}

/**
 * 生成文本格式收据
 * @param {Object} record - 存证记录
 * @returns {string}
 */
function generateTextReceipt(record) {
  const divider = '━━━━━━━━━━━━━━━━━━━━━━━━';
  const thinDivider = '────────────────────────';
  
  const lines = [
    divider,
    '📜 铭印 · BSV司法存证',
    divider,
    `存证编号：${record.attestId}`,
    `类型：${record.type || '对话存证'}`,
    `内容哈希：${record.contentHash ? record.contentHash.substring(0, 16) + '...' : 'N/A'}`,
    `Merkle根：${record.merkleRoot ? record.merkleRoot.substring(0, 16) + '...' : 'N/A'}`,
    `记录数：${record.recordCount || 1}`,
    `状态：${record.status || 'pending'}`,
    '',
    thinDivider,
    '⛓️ 区块链锚定信息',
    thinDivider
  ];
  
  if (record.txId) {
    lines.push(`TxID：${record.txId}`);
    lines.push(`区块：待确认`);
  } else {
    lines.push(`TxID：${record.unsignedTx ? record.unsignedTx.substring(0, 16) + '...(待签名)' : '待构造'}`);
  }
  
  lines.push(
    `协议：${record.protocol || 'MSLL'} v${record.version || '1.0'}`,
    `批次ID：${record.batchId || 'N/A'}`,
    '',
    thinDivider,
    '💰 费用信息',
    thinDivider,
    `费率：约 ${record.fee || 1000} sat`,
    `费用：$${((record.fee || 1000) * 0.00000001 * 300).toFixed(4)} (≈$0.01)`,
    '',
    divider,
    `时间：${record.timestamp || new Date().toISOString()}`,
    divider,
    '',
    '🏛️ 铭链科技 · 铭印 MingSeal',
    'BSV区块链司法存证 · 不可篡改 · 可验证',
    '',
    '⚠️ 本收据为存证凭证，实际TxID需签名上链后生效'
  );
  
  return lines.join('\n');
}

/**
 * 生成紧凑文本收据（用于消息回复）
 * @param {Object} record - 存证记录
 * @returns {string}
 */
function generateCompactReceipt(record) {
  const statusEmoji = record.status === 'anchored' ? '✅' : '⏳';
  const txDisplay = record.txId 
    ? record.txId.substring(0, 8) + '...' + record.txId.slice(-6)
    : '待上链';
  
  return [
    `${statusEmoji} 铭印存证 [#${record.attestId}]`,
    `📦 ${record.recordCount || 1}条记录`,
    `🔗 ${txDisplay}`,
    `⏰ ${new Date(record.timestamp).toLocaleString('zh-CN')}`,
    `💎 协议: ${record.protocol || 'MSLL'}/${record.version || '1.0'}`
  ].join('\n');
}

/**
 * 生成图片存证收据
 * @param {Object} record - 图片存证记录
 * @returns {string}
 */
function generateImageReceipt(record) {
  const divider = '━━━━━━━━━━━━━━━━━━━━━━━━';
  const thinDivider = '────────────────────────';
  
  // 文件大小格式化
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };
  
  // EXIF信息格式化
  const formatExif = (exif) => {
    if (!exif || Object.keys(exif).filter(k => exif[k]).length === 0) {
      return '  无EXIF信息';
    }
    const parts = [];
    if (exif.dateTime) parts.push(`📅 ${exif.dateTime}`);
    if (exif.make) parts.push(`📱 ${exif.make}`);
    if (exif.model) parts.push(`📷 ${exif.model}`);
    return parts.length > 0 ? parts.join('\n  ') : '  无关键EXIF信息';
  };
  
  const lines = [
    divider,
    '📸 铭印 · 图片司法存证',
    divider,
    '',
    `🆔 存证编号：${record.attestId}`,
    `📁 文件类型：${record.mimeType || 'image/jpeg'}`,
    `📏 文件大小：${formatFileSize(record.fileSize || 0)}`,
    '',
    thinDivider,
    '🔐 哈希信息',
    thinDivider,
    `  内容哈希(SHA-256):`,
    `  ${record.contentHash || 'N/A'}`,
    '',
    `  感知哈希(pHash):`,
    `  ${record.perceptualHash || 'N/A'}`,
    '',
    thinDivider,
    '📋 EXIF信息',
    thinDivider,
    `  ${formatExif(record.exif)}`,
    '',
    thinDivider,
    '⛓️ 区块链锚定',
    thinDivider,
    `  Merkle根：${record.merkleRoot ? record.merkleRoot.substring(0, 24) + '...' : '待构造'}`,
    `  批次ID：${record.batchId || 'N/A'}`,
    `  状态：${record.status || 'pending'}`,
    '',
    divider,
    `⏰ 存证时间：${new Date(record.timestamp).toLocaleString('zh-CN')}`,
    divider,
    '',
    '🏛️ 铭链科技 · 铭印 MingSeal',
    '📷 图片哈希锚定 · 不可篡改 · 可验证',
    '',
    '⚠️ 本收据证明图片内容已哈希锚定',
    '   实际TxID需签名上链后生效'
  ];
  
  return lines.join('\n');
}

/**
 * 生成存证记录摘要
 * @param {Object} record - 存证记录
 * @returns {Object}
 */
function summarizeRecord(record) {
  return {
    id: record.attestId,
    type: record.type,
    hash: record.contentHash ? record.contentHash.substring(0, 16) + '...' : null,
    merkleRoot: record.merkleRoot ? record.merkleRoot.substring(0, 16) + '...' : null,
    tx: record.txId ? record.txId.substring(0, 8) + '...' : null,
    status: record.status,
    time: new Date(record.timestamp).toLocaleString('zh-CN')
  };
}

/**
 * 生成验证报告
 * @param {Object} record - 存证记录
 * @param {boolean} isValid - 验证结果
 * @param {string} message - 验证消息
 * @returns {string}
 */
function generateVerificationReport(record, isValid, message) {
  const statusIcon = isValid ? '✅' : '❌';
  
  const report = [
    `${statusIcon} 铭印存证验证报告`,
    '═══════════════════════════════',
    '',
    `存证编号：${record.attestId}`,
    `存证类型：${record.type === 'image' ? '📸 图片存证' : '对话存证'}`,
    `存证时间：${new Date(record.timestamp).toLocaleString('zh-CN')}`,
    ''
  ];
  
  // 图片存证额外信息
  if (record.type === 'image') {
    report.push(
      '┌─ 图片信息 ────────────────┐',
      `│ 文件类型  │ ${record.mimeType || 'N/A'}`,
      `│ 文件大小  │ ${((record.fileSize || 0) / 1024).toFixed(1)} KB`,
      '├─────────────────────────────────┤'
    );
    
    if (record.exif && record.exif.dateTime) {
      report.push(`│ 拍摄时间  │ ${record.exif.dateTime}`);
    }
    if (record.exif && record.exif.make) {
      report.push(`│ 设备厂商  │ ${record.exif.make}`);
    }
    if (record.exif && record.exif.model) {
      report.push(`│ 设备型号  │ ${record.exif.model}`);
    }
    
    report.push('├─────────────────────────────────┤');
    report.push(`│ 内容哈希  │ ${record.contentHash ? '✓' : '✗'}`);
    report.push(`│ 感知哈希  │ ${record.perceptualHash ? '✓' : '✗'}`);
    report.push('└─────────────────────────────────┘');
  } else {
    report.push(
      '┌─ 验证项目 ─┐',
      `│ Merkle根  │ ${isValid ? '✓' : '✗'}`,
      `│ 内容哈希  │ ${isValid ? '✓' : '✗'}`,
      `│ 链上锚定  │ ${record.txId ? '✓' : '⏳'}`,
      '└───────────┘'
    );
  }
  
  report.push(
    '',
    `验证结果：${isValid ? '通过' : '失败'}`,
    message ? `说明：${message}` : '',
    '',
    '═══════════════════════════════',
    '铭链科技 · 铭印 MingSeal'
  );
  
  return report.filter(line => line !== undefined).join('\n');
}

/**
 * 导出存证数据为JSON
 * @param {Object} record - 存证记录
 * @returns {string}
 */
function exportToJson(record) {
  return JSON.stringify({
    version: '1.0',
    protocol: 'MingSeal',
    attestId: record.attestId,
    type: record.type,
    contentHash: record.contentHash,
    merkleRoot: record.merkleRoot,
    merkleProof: record.merkleProof,
    recordCount: record.recordCount,
    batchId: record.batchId,
    txId: record.txId,
    unsignedTx: record.unsignedTx,
    protocol: 'MSLL',
    version: '1.0',
    timestamp: record.timestamp,
    network: record.network || 'mainnet',
    wallet: record.walletAddress,
    fee: record.fee,
    status: record.status
  }, null, 2);
}

/**
 * 导出图片存证数据为JSON
 * @param {Object} record - 图片存证记录
 * @returns {string}
 */
function exportImageToJson(record) {
  const exportData = {
    version: '1.0',
    protocol: 'MingSeal',
    attestId: record.attestId,
    type: 'image',
    contentHash: record.contentHash,
    perceptualHash: record.perceptualHash,
    fileSize: record.fileSize,
    mimeType: record.mimeType,
    exif: record.exif || {},
    merkleRoot: record.merkleRoot,
    merkleProof: record.merkleProof,
    recordCount: 1,
    batchId: record.batchId,
    txId: record.txId,
    unsignedTx: record.unsignedTx,
    protocol: 'MSLL',
    version: '1.0',
    timestamp: record.timestamp,
    network: record.network || 'mainnet',
    wallet: record.walletAddress,
    fee: record.fee,
    status: record.status
  };
  
  return JSON.stringify(exportData, null, 2);
}

module.exports = {
  generateAttestId,
  generateTextReceipt,
  generateCompactReceipt,
  generateImageReceipt,
  summarizeRecord,
  generateVerificationReport,
  exportToJson,
  exportImageToJson
};
