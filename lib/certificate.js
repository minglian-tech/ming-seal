/**
 * 标准MingSeal存证证书生成器
 * 生成双语版PDF格式，与MS20260503-0001/0002完全一致
 * 依赖: wkhtmltopdf（已安装）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CERT_DIR = "/root/.openclaw/workspace/存证证书";

/**
 * 生成标准双语存证证书PDF
 * @param {Object} info - 存证信息
 * @param {string} info.attestId - 存证编号 e.g. MS20260503-0003
 * @param {string} info.txId - BSV交易ID
 * @param {string} info.sha256Hex - SHA-256十六进制
 * @param {string} info.sha256B64 - SHA-256 Base64
 * @param {string} info.timestamp - ISO时间戳
 * @param {Object} info.opReturn - OP_RETURN JSON对象
 * @param {string} info.filename - 文件名
 * @param {number} info.fileSize - 文件大小(bytes)
 * @param {string} info.fileType - 文件类型描述 e.g. "JPEG (图片)"
 * @param {string} info.address - BSV钱包地址
 * @param {Object} [info.extra] - 额外信息字段
 * @returns {string} PDF文件路径
 */
function generateCertificate(info) {
  const fileName = `存证证书_${info.attestId}.pdf`;
  const filePath = path.join(CERT_DIR, fileName);
  
  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
  }

  const fileSizeHuman = info.fileSize >= 1024*1024 
    ? (info.fileSize/1024/1024).toFixed(2) + ' MB'
    : (info.fileSize/1024).toFixed(1) + ' KB';

  const opReturnStr = JSON.stringify(info.opReturn);
  
  const timeHuman = new Date(info.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const timeUTC = info.timestamp;

  const opacityReturnEscaped = opReturnStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Arial', sans-serif; color: #333; }
  .header { text-align: center; padding: 18px 0 10px 0; border-bottom: 2px solid #b8860b; margin-bottom: 24px; }
  .header h1 { font-size: 21px; color: #8B4513; margin: 0; letter-spacing: 5px; }
  .header .en { font-size: 13px; color: #999; margin-top: 4px; letter-spacing: 2px; }
  .header .id { font-size: 15px; color: #b8860b; margin-top: 6px; font-weight: bold; letter-spacing: 2px; }
  .section { margin: 16px 0; }
  .section h2 { font-size: 14px; color: #8B4513; border-left: 4px solid #b8860b; padding-left: 10px; margin: 0 0 10px 0; }
  .row { display: flex; padding: 3px 0; line-height: 1.5; font-size: 13px; }
  .label { width: 130px; color: #888; flex-shrink: 0; }
  .label-en { width: 130px; color: #bbb; font-size: 11px; flex-shrink: 0; }
  .value { flex: 1; font-weight: bold; font-size: 13px; }
  .hash-block { background: #f5f5f5; padding: 8px 12px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 11px; word-break: break-all; margin: 4px 0; line-height: 1.6; }
  .opreturn-block { background: #fefce8; border: 1px solid #facc15; padding: 8px 12px; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 10px; word-break: break-all; margin: 4px 0; line-height: 1.5; }
  .verify-box { background: #f0f7ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 12px 16px; margin-top: 16px; }
  .verify-box ol { margin: 2px 0; padding-left: 20px; }
  .verify-box li { margin: 5px 0; line-height: 1.5; font-size: 12px; }
  .verify-box code { background: #e5e7eb; padding: 1px 4px; border-radius: 2px; font-size: 11px; }
  .verify-box a { color: #2563eb; }
  .footer { text-align: center; color: #aaa; font-size: 10px; margin-top: 24px; padding-top: 12px; border-top: 1px solid #ddd; }
</style>
</head>
<body>

<div class="header">
  <h1>铭链科技 · MingSeal 区块链存证证书</h1>
  <div class="en">Blockchain Attestation Certificate</div>
  <div class="id">#${info.attestId}</div>
</div>

<div class="section">
  <h2>存证信息 / Attestation Info</h2>
  <div class="row"><div class="label">存证编号</div><div class="value">${info.attestId}</div></div>
  <div class="row"><div class="label-en">Attest ID</div><div class="value" style="color:#bbb;font-size:11px;">${info.attestId}</div></div>
  <div class="row"><div class="label">存证协议</div><div class="value">MingSeal v1 · OP_FALSE OP_RETURN</div></div>
  <div class="row"><div class="label-en">Protocol</div><div class="value" style="color:#bbb;font-size:11px;">MingSeal v1 · OP_FALSE OP_RETURN</div></div>
  <div class="row"><div class="label">区块链网络</div><div class="value">Bitcoin SV (BSV) Mainnet</div></div>
  <div class="row"><div class="label-en">Network</div><div class="value" style="color:#bbb;font-size:11px;">Bitcoin SV (BSV) Mainnet</div></div>
  <div class="row"><div class="label">存证时间</div><div class="value">${timeHuman}</div></div>
  <div class="row"><div class="label-en">Timestamp</div><div class="value" style="color:#bbb;font-size:11px;">${timeUTC}</div></div>
  <div class="row"><div class="label">交易ID (TxID)</div><div class="value" style="font-family:'Courier New',monospace;font-size:11px;word-break:break-all;color:#2563eb;">${info.txId}</div></div>
  <div class="row"><div class="label">存证地址</div><div class="value" style="font-family:'Courier New',monospace;font-size:11px;">${info.address}</div></div>
  <div class="row"><div class="label-en">Address</div><div class="value" style="color:#bbb;font-size:11px;">${info.address}</div></div>
</div>

<div class="section">
  <h2>文件信息 / File Info</h2>
  <div class="row"><div class="label">文件名称</div><div class="value">${info.filename}</div></div>
  <div class="row"><div class="label-en">Filename</div><div class="value" style="color:#bbb;font-size:11px;">${info.filename}</div></div>
  <div class="row"><div class="label">文件大小</div><div class="value">${fileSizeHuman}</div></div>
  <div class="row"><div class="label">文件类型</div><div class="value">${info.fileType || '未知'}</div></div>
</div>

<div class="section">
  <h2>数字指纹 / Digital Fingerprint</h2>
  <div class="row"><div class="label">SHA-256 (Hex)</div></div>
  <div class="hash-block">${info.sha256Hex}</div>
  <div class="row"><div class="label">SHA-256 (B64)</div><div class="value" style="font-size:10px;word-break:break-all;">${info.sha256B64}</div></div>
</div>

<div class="section">
  <h2>链上存证数据 / OP_RETURN</h2>
  <div class="opreturn-block">${opacityReturnEscaped}</div>
</div>

<div class="section">
  <h2>验证方法 / Verification</h2>
  <div class="verify-box">
    <ol>
      <li>访问 <a href="https://whatsonchain.com">https://whatsonchain.com</a>，搜索上方交易ID</li>
      <li>在交易详情页的 OP_RETURN 字段查看链上存证数据</li>
      <li>使用 <code>sha256sum</code> 计算原始文件的 SHA-256 哈希，与证书数据比对</li>
      <li>哈希一致即证明文件在存证时间点已存在且未被篡改</li>
    </ol>
  </div>
</div>

<div class="footer">
  铭链科技生成 | 基于BSV区块链存证 | SHA-256哈希验证 | 不可篡改<br>
  证书编号: ${info.attestId} | 生成时间: ${timeUTC}
</div>

</body>
</html>`;

  const htmlPath = `/tmp/cert_${info.attestId}.html`;
  fs.writeFileSync(htmlPath, html, 'utf8');
  
  // Use wkhtmltopdf to generate PDF
  const cmd = `wkhtmltopdf --encoding UTF-8 --page-size A4 --margin-top 15mm --margin-bottom 15mm --margin-left 12mm --margin-right 12mm "${htmlPath}" "${filePath}" 2>&1`;
  execSync(cmd, { stdio: 'pipe', timeout: 30000 });
  
  // Cleanup temp HTML
  try { fs.unlinkSync(htmlPath); } catch(e) {}
  
  return filePath;
}

/**
 * 生成JSON存证信息文件（配套证书）
 */
function generateCertJson(info) {
  const fileName = `存证信息_${info.attestId}.json`;
  const filePath = path.join(CERT_DIR, fileName);
  
  const jsonData = {
    attestId: info.attestId,
    type: info.fileType || '未知',
    filename: info.filename,
    fileSize: info.fileSize,
    contentHash: info.sha256Hex,
    contentHashB64: info.sha256B64,
    timestamp: info.timestamp,
    txId: info.txId,
    OP_RETURN: info.opReturn,
    protocol: 'MingSeal v1',
    network: 'BSV Mainnet',
    walletAddress: info.address,
    blockExplorer: `https://whatsonchain.com/tx/${info.txId}`
  };
  
  fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
  return filePath;
}


module.exports = { generateCertificate, generateCertJson, CERT_DIR };

// === 自测 ===
if (require.main === module) {
  const info = {
    attestId: 'MS20260503-0003',
    txId: 'eafbce86553ed5ffd7069bf159bd28332ce13303d86cac49746111c87a9b4ca1',
    sha256Hex: '235bba65fde2e29b5f5dd22541301858f28345100cd4d64372b78a9a6756b73e',
    sha256B64: 'I3u6Zf3i4ptf3dIlQTAYWPKEUQwM1PZDK3eKmmdrB5I=',
    timestamp: '2026-05-03T05:08:44.897Z',
    opReturn: {m:"MSLL",v:1,r:"235bba65fde2e29b",b:"MS20260503-0003",c:1,t:"2026-05-03T05:08:44.897Z"},
    filename: 'wechat_image_0503.jpg',
    fileSize: 1485817,
    fileType: 'JPEG (图片)',
    address: '1HQTm7L2KXTmNTecedhFRnQqP98yU1GAD7'
  };
  
  const pdfPath = generateCertificate(info);
  const jsonPath = generateCertJson(info);
  console.log('PDF:', pdfPath);
  console.log('JSON:', jsonPath);
}

