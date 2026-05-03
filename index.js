/**
 * 铭印 MingSeal - BSV司法存证插件
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 导入子模块
const merkle = require('./lib/merkle');
const sanitizer = require('./lib/sanitizer');
const bsvAnchor = require('./lib/bsv-anchor');
const receipt = require('./lib/receipt');
const certificate = require('./lib/certificate');
const imageHash = require('./lib/image-hash');

// ========== 工具函数 ==========

function uuid() {
  return crypto.randomUUID();
}

function timestamp() {
  return new Date().toISOString();
}

function safeReadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error('[MingSeal] 读取文件失败:', filePath, e.message);
  }
  return null;
}

function safeWriteJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[MingSeal] 写入文件失败:', filePath, e.message);
    return false;
  }
}

// ========== 插件状态 ==========

let state = {
  api: null,
  config: null,
  records: [],
  recordCounter: 0,
  recordsPath: null,
  queuePath: null,
  offlineQueue: null,
  conversationBuffer: [],
  flushTimer: null,
  initialized: false
};

/**
 * 初始化插件状态
 */
function ensureInitialized() {
  if (state.initialized) return;
  
  // 默认配置
  state.config = {
    enabled: true,
    autoAttest: true,
    autoSign: true,
    batchSize: 100,
    network: 'mainnet',
    workspaceDir: 'ming-seal-records',
    bsvWallet: '1HQTm7L2KXTmNTecedhFRnQqP98yU1GAD7',
    // bsvWif: 从 wallet.json 配置文件读取（详见 README）,
    bsvWif: process.env.MINGSEAL_BSV_WIF || null,
    sanitizeRules: [
      'phone', 'mobile', 'tel',
      'email',
      'id_card', 'id_number', 'idcard',
      'bank_card', 'credit_card',
      'address',
      'password', 'pwd', 'passwd', 'secret', 'token',
      'api_key', 'api-key', 'private_key', 'private-key',
      'authorization', 'bearer', 'x-api-key'
    ]
  };

  // 设置路径
  const baseDir = process.env.OPENCLAW_STATE_DIR || '/root/.openclaw';
  const workspaceDir = path.join(baseDir, state.config.workspaceDir);
  
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }
  
  state.recordsPath = path.join(workspaceDir, 'records.json');
  state.queuePath = path.join(workspaceDir, 'queue.json');
  
  // 加载已有记录
  const savedRecords = safeReadJson(state.recordsPath);
  if (savedRecords && Array.isArray(savedRecords)) {
    state.records = savedRecords;
    state.recordCounter = savedRecords.length;
  }
  
  // 加载离线队列
  state.offlineQueue = new bsvAnchor.OfflineQueue();
  const savedQueue = safeReadJson(state.queuePath);
  if (savedQueue && Array.isArray(savedQueue)) {
    state.offlineQueue.restore(savedQueue);
  }
  
  // 启动定时刷新
  state.flushTimer = setInterval(() => {
    if (state.conversationBuffer.length > 0) {
      console.log('[MingSeal] 定时刷新缓冲区');
      flushBuffer();
    }
  }, 5 * 60 * 1000);
  
  state.initialized = true;
  
  console.log('[MingSeal] 铭印司法存证插件初始化完成');
  console.log('[MingSeal] 工作目录:', workspaceDir);
  console.log('[MingSeal] 自动存证:', state.config.autoAttest);
  console.log('[MingSeal] 批量大小:', state.config.batchSize);
  console.log('[MingSeal] BSV钱包:', state.config.bsvWallet);
  console.log('[MingSeal] 离线队列:', state.offlineQueue.size(), '条待处理');
}

/**
 * 初始化插件
 */
function init(api, config) {
  state.api = api;
  if (config) {
    state.config = { ...state.config, ...config };
  }
  ensureInitialized();
}

/**
 * 注册钩子
 */
function register(api) {
  // 确保初始化（OpenClaw可能先调用register）
  ensureInitialized();
  state.api = api;

  // 消息接收钩子
  api.on('message_received', async (event) => {
    if (!state.config.enabled) return;
    await onMessage(event);
  });

  // Agent结束钩子
  api.on('agent_end', async (event) => {
    if (!state.config.enabled) return;
    await onAgentEnd(event);
  });
  
  // 注册工具
  registerTools(api);
  
  console.log('[MingSeal] 钩子注册完成');
}

/**
 * 注册工具
 */
function registerTools(api) {
  api.registerTool({
    name: 'ming_seal_attest',
    description: '手动触发BSV区块链存证。触发词：存证、铭印、盖章',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '可选的存证内容'
        }
      }
    },
    async execute(args) {
      const result = await performAttestation('manual-text', args.content ? { text: args.content } : { text: '手动存证' });
      if (result.success) {
        return {
          content: [{ type: 'text', text: result.receipt + '\n\n💡 请使用私钥签名交易后上链' }]
        };
      } else {
        return {
          content: [{ type: 'text', text: '❌ 存证失败: ' + result.error }]
        };
      }
    }
  });

  api.registerTool({
    name: 'ming_seal_verify',
    description: '验证链上存证',
    parameters: {
      type: 'object',
      properties: {
        txId: { type: 'string', description: 'TxID或存证编号' }
      },
      required: ['txId']
    },
    async execute(args) {
      return await handleVerifyCommand(args.txId);
    }
  });

  api.registerTool({
    name: 'ming_seal_certificate',
    description: '查看存证证书',
    parameters: {
      type: 'object',
      properties: {
        attestId: { type: 'string', description: '存证编号' }
      }
    },
    async execute(args) {
      return await handleCertificateCommand(args.attestId);
    }
  });

  api.registerTool({
    name: 'ming_seal_status',
    description: '查看存证队列状态',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return await handleStatusCommand();
    }
  });

  api.registerTool({
    name: 'ming_seal_flush',
    description: '手动触发缓冲区刷新',
    parameters: { type: 'object', properties: {} },
    async execute() {
      if (state.conversationBuffer.length === 0) {
        return { content: [{ type: 'text', text: '✅ 缓冲区已为空' }] };
      }
      await flushBuffer();
      return { content: [{ type: 'text', text: '✅ 缓冲区刷新完成' }] };
    }
  });

  // 图片存证工具
  api.registerTool({
    name: 'ming_seal_image_attest',
    description: '图片存证：将图片URL或图片信息进行BSV区块链存证。触发词：存证照片、铭印照片、拍照存证',
    parameters: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: '图片URL' },
        imageData: { type: 'string', description: '可选的Base64图片数据' }
      }
    },
    async execute(args) {
      const result = await performImageAttestation(args.imageUrl || args.imageData);
      if (result.success) {
        return {
          content: [{ type: 'text', text: result.receipt + '\n\n💡 图片存证完成，请使用私钥签名交易后上链' }]
        };
      } else {
        return {
          content: [{ type: 'text', text: '❌ 图片存证失败: ' + result.error }]
        };
      }
    }
  });

  // 通用文件存证工具
  api.registerTool({
    name: 'ming_seal_file_attest',
    description: '文件存证：将文件（图片、视频、PDF、文档等）进行BSV区块链存证。触发词：存证文件、文件上链、铭印文件',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '本地文件路径' },
        fileDescription: { type: 'string', description: '可选的文件描述' }
      },
      required: ['filePath']
    },
    async execute(args) {
      const result = await performFileAttestation(args.filePath, args.fileDescription);
      if (result.success) {
        return { content: [{ type: 'text', text: result.receipt }] };
      } else {
        return { content: [{ type: 'text', text: '❌ 文件存证失败: ' + result.error }] };
      }
    }
  });

  // 批量文件存证
  api.registerTool({
    name: 'ming_seal_batch_attest',
    description: '批量文件存证：将多个文件一次性批量进行BSV区块链存证',
    parameters: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, description: '文件路径列表' }
      },
      required: ['filePaths']
    },
    async execute(args) {
      const results = [];
      for (const fp of (args.filePaths || [])) {
        const r = await performFileAttestation(fp);
        results.push(r);
      }
      const success = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      const detail = results.map((r, i) => 
        r.success 
          ? `✅ ${args.filePaths[i]} → ${r.attestId}`
          : `❌ ${args.filePaths[i]} → ${r.error}`
      ).join('\n');
      return { content: [{ type: 'text', text: 
        `📦 批量文件存证\n✅ ${success} 成功 / ❌ ${fail} 失败\n\n${detail}`
      }]};
    }
  });
}

// ========== 文件类型检测 ==========

/**
 * 文件类型映射表
 */
const FILE_TYPES = {
  // 图片
  jpg: { mime: 'image/jpeg', type: 'image', icon: '📷', category: '图片' },
  jpeg: { mime: 'image/jpeg', type: 'image', icon: '📷', category: '图片' },
  png: { mime: 'image/png', type: 'image', icon: '📷', category: '图片' },
  gif: { mime: 'image/gif', type: 'image', icon: '📷', category: '图片' },
  webp: { mime: 'image/webp', type: 'image', icon: '📷', category: '图片' },
  bmp: { mime: 'image/bmp', type: 'image', icon: '📷', category: '图片' },
  // 视频
  mp4: { mime: 'video/mp4', type: 'video', icon: '🎬', category: '视频' },
  mov: { mime: 'video/quicktime', type: 'video', icon: '🎬', category: '视频' },
  avi: { mime: 'video/x-msvideo', type: 'video', icon: '🎬', category: '视频' },
  mkv: { mime: 'video/x-matroska', type: 'video', icon: '🎬', category: '视频' },
  webm: { mime: 'video/webm', type: 'video', icon: '🎬', category: '视频' },
  // 音频
  mp3: { mime: 'audio/mpeg', type: 'audio', icon: '🎵', category: '音频' },
  wav: { mime: 'audio/wav', type: 'audio', icon: '🎵', category: '音频' },
  flac: { mime: 'audio/flac', type: 'audio', icon: '🎵', category: '音频' },
  // 文档
  pdf: { mime: 'application/pdf', type: 'document', icon: '📄', category: '文档' },
  doc: { mime: 'application/msword', type: 'document', icon: '📄', category: '文档' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', type: 'document', icon: '📄', category: '文档' },
  xls: { mime: 'application/vnd.ms-excel', type: 'spreadsheet', icon: '📊', category: '表格' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', type: 'spreadsheet', icon: '📊', category: '表格' },
  ppt: { mime: 'application/vnd.ms-powerpoint', type: 'presentation', icon: '📽️', category: '演示文稿' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', type: 'presentation', icon: '📽️', category: '演示文稿' },
  // 文本
  txt: { mime: 'text/plain', type: 'text', icon: '📝', category: '文本' },
  csv: { mime: 'text/csv', type: 'text', icon: '📝', category: '文本' },
  json: { mime: 'application/json', type: 'text', icon: '📝', category: '文本' },
  md: { mime: 'text/markdown', type: 'text', icon: '📝', category: '文本' },
};

/**
 * 根据文件名检测文件类型
 * @param {string} filename 
 * @returns {Object}
 */
function detectFileTypeFromName(filename) {
  if (!filename || typeof filename !== 'string') return { mime: 'application/octet-stream', type: 'unknown', icon: '📦', category: '未知' };
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return FILE_TYPES[ext] || { mime: 'application/octet-stream', type: 'unknown', icon: '📦', category: '未知' };
}

/**
 * 读取文件并计算哈希
 * @param {string} filePath 
 * @returns {Promise<{hash: string, type: Object}>}
 */
async function hashFile(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const stat = await fs.promises.stat(filePath);
  const ft = detectFileTypeFromName(filePath);
  return {
    hash,
    hashB64: Buffer.from(hash, 'hex').toString('base64'),
    size: stat.size,
    mime: ft.mime,
    type: ft.type,
    category: ft.category,
    icon: ft.icon,
    filename: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase()
  };
}

// ========== 图片消息检测与处理 ==========

/**
 * 检测消息中是否包含图片URL
 * @param {string} message - 消息内容
 * @returns {string|null} 找到的图片URL或null
 */
function extractImageUrl(message) {
  if (!message || typeof message !== 'string') return null;
  
  // 匹配常见图片URL格式
  const patterns = [
    // https://xxx.jpg, .png, .gif, .webp
    /(https?:\/\/[^\s<>"\')]+)\.(jpg|jpeg|png|gif|webp)([?#][^\s]*)?/gi,
    // 直接的图片URL
    /(https?:\/\/[^\s<>"\')]+)/gi
  ];
  
  for (const pattern of patterns) {
    const matches = message.match(pattern);
    if (matches) {
      for (const url of matches) {
        // 排除明显不是图片的URL
        const ext = url.split('.').pop().toLowerCase().split(/[?#]/)[0];
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) {
          return url;
        }
        // 也接受任何以图片扩展名结尾或包含常见图片域名的URL
        if (url.includes('image') || url.includes('photo') || url.includes('img')) {
          return url;
        }
      }
    }
  }
  
  return null;
}

/**
 * 检测是否是图片存证触发关键词
 * @param {string} message - 消息内容
 * @returns {boolean}
 */
function isImageAttestTrigger(message) {
  if (!message || typeof message !== 'string') return false;
  const lowerMsg = message.toLowerCase();
  const keywords = ['存证照片', '铭印照片', '拍照存证', '图片存证', '照片上链'];
  return keywords.some(kw => lowerMsg.includes(kw));
}

/**
 * 图片消息钩子
 */
async function onImageMessage(event, imageUrl) {
  console.log('[MingSeal] 检测到图片消息:', imageUrl);
  try {
    const result = await performImageAttestation(imageUrl);
    if (result.success) {
      console.log('[MingSeal] 图片存证成功:', result.attestId);
    } else {
      console.error('[MingSeal] 图片存证失败:', result.error);
    }
  } catch (error) {
    console.error('[MingSeal] 图片处理异常:', error.message);
  }
}

/**
 * 执行通用文件存证
 * @param {string} filePath - 本地文件路径
 * @param {string} description - 可选描述
 * @returns {Promise<Object>}
 */
async function performFileAttestation(filePath, description) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在: ' + filePath };
    }
    
    // 读取文件并计算哈希
    const fileInfo = await hashFile(filePath);
    
    state.recordCounter++;
    const attestId = receipt.generateAttestId(state.recordCounter);
    
    const record = {
      attestId,
      type: fileInfo.type,
      category: fileInfo.category,
      icon: fileInfo.icon,
      contentHash: fileInfo.hash,
      contentHashB64: fileInfo.hashB64,
      fileSize: fileInfo.size,
      mimeType: fileInfo.mime,
      filename: fileInfo.filename,
      fileTypeDesc: (FILE_TYPES[fileInfo.ext ? fileInfo.ext.replace(".","") : ""] || {}).category || '未知',
      extension: fileInfo.ext,
      description: description || '',
      timestamp: timestamp(),
      status: 'pending',
      merkleRoot: null,
      txId: null,
      unsignedTx: null,
      recordCount: 1,
      batchId: null,
      protocol: 'MSLL',
      version: '1.0',
      network: state.config.network,
      walletAddress: state.config.bsvWallet,
      fee: 1000
    };
    
    state.conversationBuffer.push(record);
    state.records.push(record);
    
    if (state.conversationBuffer.length >= state.config.batchSize) {
      await flushBuffer();
    }
    
    saveRecords();
    
    return {
      success: true,
      attestId,
      receipt: [
        `${fileInfo.icon} ${fileInfo.icon === '📷' ? '图片' : fileInfo.category}存证成功 [#${attestId}]`,
        `📁 ${fileInfo.filename}`,
        `📏 ${(fileInfo.size / 1024).toFixed(1)} KB`,
        `🔐 SHA-256: ${fileInfo.hash.substring(0, 16)}...`,
        `⏰ ${new Date().toLocaleString('zh-CN')}`
      ].join('\n')
    };
  } catch (error) {
    console.error('[MingSeal] 文件存证异常:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 执行图片存证
 * @param {string} imageInput - 图片URL或Base64
 * @returns {Promise<Object>} 存证结果
 */
async function performImageAttestation(imageInput) {
  try {
    let imageUrl = imageInput;
    
    // 处理Base64图片数据
    if (imageInput && imageInput.startsWith('data:')) {
      // Base64图片暂不处理，提示用户使用URL
      return { success: false, error: '请提供图片URL而非Base64数据' };
    }
    
    if (!imageUrl || typeof imageUrl !== 'string') {
      return { success: false, error: '未提供有效的图片URL' };
    }
    
    // 下载并处理图片
    const imageInfo = await imageHash.processImage(imageUrl);
    
    // 构建图片存证记录
    state.recordCounter++;
    const attestId = receipt.generateAttestId(state.recordCounter);
    
    const record = {
      attestId,
      type: 'image',
      contentHash: imageInfo.contentHash,
      perceptualHash: imageInfo.perceptualHash,
      fileSize: imageInfo.fileSize,
      mimeType: imageInfo.mimeType,
      exif: imageInfo.exif,
      imageUrl: imageUrl.substring(0, 200), // 截断长URL
      timestamp: timestamp(),
      status: 'pending',
      merkleRoot: null,
      txId: null,
      unsignedTx: null,
      recordCount: 1,
      batchId: null,
      protocol: 'MSLL',
      version: '1.0',
      network: state.config.network,
      walletAddress: state.config.bsvWallet,
      fee: 1000
    };
    
    // 添加到缓冲区
    state.conversationBuffer.push(record);
    state.records.push(record);
    
    // 达到批量大小时刷新
    if (state.conversationBuffer.length >= state.config.batchSize) {
      await flushBuffer();
    }
    
    saveRecords();
    const receiptText = receipt.generateImageReceipt(record);
    
    return { success: true, attestId, receipt: receiptText };
  } catch (error) {
    console.error('[MingSeal] 图片存证异常:', error);
    return { success: false, error: error.message };
  }
}

// ========== 原有文本消息处理 ==========

/**
 * 消息钩子
 */
async function onMessage(event) {
  const message = event.message || '';
  const lowerMsg = message.toLowerCase();
  
  // 检测图片存证触发词
  if (isImageAttestTrigger(message)) {
    const imageUrl = extractImageUrl(message);
    if (imageUrl) {
      await onImageMessage(event, imageUrl);
      return;
    }
  }
  
  // 原有文本存证关键词
  const attestKeywords = ['存证', '铭印', '盖章', '上链'];
  if (attestKeywords.some(kw => lowerMsg.includes(kw))) {
    console.log('[MingSeal] 检测到存证命令:', message);
    await performAttestation('manual', { message, sessionId: event.context?.sessionId });
  }
}

/**
 * Agent结束钩子
 */
async function onAgentEnd(event) {
  if (!state.config.autoAttest) return;
  const conversationData = event.context?.conversation || event.conversation || [];
  if (conversationData.length > 0) {
    console.log('[MingSeal] 对话结束，自动触发存证');
    await performAttestation('auto', { conversation: conversationData, sessionId: event.context?.sessionId });
  }
}

/**
 * 执行存证
 */
async function performAttestation(type, data) {
  try {
    const sanitizedData = sanitizer.deepSanitize(data, state.config.sanitizeRules);
    const contentHash = merkle.sha256(sanitizedData);
    
    state.recordCounter++;
    const attestId = receipt.generateAttestId(state.recordCounter);
    const record = {
      attestId,
      type,
      contentHash,
      content: sanitizedData,
      timestamp: timestamp(),
      status: 'pending',
      merkleRoot: null,
      txId: null,
      unsignedTx: null,
      recordCount: 1,
      batchId: null,
      protocol: 'MSLL',
      version: '1.0',
      network: state.config.network,
      walletAddress: state.config.bsvWallet,
      fee: 1000
    };
    
    state.conversationBuffer.push(record);
    state.records.push(record);
    
    if (state.conversationBuffer.length >= state.config.batchSize) {
      await flushBuffer();
    }
    
    saveRecords();
    const receiptText = receipt.generateCompactReceipt(record);
    
    return { success: true, attestId, receipt: receiptText };
  } catch (error) {
    console.error('[MingSeal] 存证失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 刷新缓冲区
 */
async function flushBuffer() {
  if (state.conversationBuffer.length === 0) return;

  console.log('[MingSeal] 刷新缓冲区，记录数:', state.conversationBuffer.length);

  const hashes = state.conversationBuffer.map(r => r.contentHash);
  const { root, proofs } = merkle.buildMerkleTree(hashes);
  const batchId = merkle.generateBatchId();
  
  const txData = bsvAnchor.buildBSVOpReturnTx(
    root, state.config.bsvWallet, state.conversationBuffer.length, { batchId }
  );
  
  for (const record of state.conversationBuffer) {
    record.merkleRoot = root;
    record.batchId = batchId;
    record.merkleProof = proofs[record.contentHash];
    record.unsignedTx = txData.unsignedHex;
    record.fee = txData.estimatedFee;
    record.status = 'constructed';
  }
  
  state.offlineQueue.enqueue(batchId, {
    merkleRoot: root, batchId, txHex: txData.unsignedHex,
    recordIds: state.conversationBuffer.map(r => r.attestId), timestamp: timestamp()
  });
  
  state.conversationBuffer = [];
  saveQueue();
  
  console.log('[MingSeal] Merkle根:', root.substring(0, 16) + '...');
  console.log('[MingSeal] 批次ID:', batchId);
  console.log('[MingSeal] 离线队列:', state.offlineQueue.size(), '个待处理批次');
  
  // 自动签名广播
  if (state.config.autoSign && state.config.bsvWif) {
    console.log('[MingSeal] 自动签名广播队列...');
    await processQueue();
  }
}

/**
 * 处理离线队列：签名并广播所有待处理批次
 */
async function processQueue() {
  if (!state.config.autoSign || !state.config.bsvWif) return;
  
  while (!state.offlineQueue.isEmpty()) {
    const batch = state.offlineQueue.dequeue();
    if (!batch) break;
    
    console.log('[MingSeal] 签名广播批次:', batch.batchId, 'root:', (batch.merkleRoot || '').substring(0, 16));
    
    try {
      const result = await bsvAnchor.buildSignAndBroadcast(
        batch.merkleRoot,
        state.config.bsvWif,
        batch.recordIds ? batch.recordIds.length : 1,
        { batchId: batch.batchId }
      );
      
      console.log('[MingSeal] ✅ 上链成功 TxID:', result.txId);
      
      // 更新所有相关记录的txId
      const txId = result.broadcastTxId || result.txId;
      if (batch.recordIds && Array.isArray(batch.recordIds)) {
        for (const rid of batch.recordIds) {
          const rec = state.records.find(r => r.attestId === rid);
          if (rec) {
            rec.txId = txId;
            rec.status = 'anchored';
            rec.broadcastTxId = txId;
            // 自动生成PDF证书（标准双语格式）
            try {
              const sha256B64 = Buffer.from(rec.contentHash || '', 'hex').toString('base64');
              const opReturnPayload = {
                m: 'MSLL',
                v: 1,
                r: (rec.merkleRoot || rec.contentHash || '').substring(0, 16),
                b: rec.batchId || rec.attestId,
                c: 1,
                t: rec.timestamp || new Date().toISOString()
              };
              certificate.generateCertificate({
                attestId: rec.attestId,
                txId: txId,
                sha256Hex: rec.contentHash || '',
                sha256B64: sha256B64,
                timestamp: rec.timestamp || new Date().toISOString(),
                opReturn: opReturnPayload,
                filename: rec.filename || ('batch_' + (rec.batchId || rec.attestId)),
                fileSize: rec.fileSize || 0,
                fileType: rec.fileTypeDesc || rec.category || '未知',
                address: state.config.bsvWallet
              });
              certificate.generateCertJson({
                attestId: rec.attestId,
                txId: txId,
                sha256Hex: rec.contentHash || '',
                sha256B64: sha256B64,
                timestamp: rec.timestamp || new Date().toISOString(),
                opReturn: opReturnPayload,
                filename: rec.filename || ('batch_' + (rec.batchId || rec.attestId)),
                fileSize: rec.fileSize || 0,
                fileType: rec.fileTypeDesc || rec.category || '未知',
                address: state.config.bsvWallet
              });
              console.log('[MingSeal] 📄 证书已生成:', rec.attestId);
            } catch (certErr) {
              console.error('[MingSeal] 证书生成失败:', certErr.message);
            }
          }
        }
      }
      saveRecords();
    } catch (e) {
      console.error('[MingSeal] ❌ 签名广播失败:', e.message);
      // 放回队列末尾重试
      state.offlineQueue.enqueue(batch.batchId, batch);
      break; // 失败后先停，下次再试
    }
  }
  saveQueue();
}

/**
 * 保存记录
 */
function saveRecords() {
  safeWriteJson(state.recordsPath, state.records);
}

/**
 * 保存队列
 */
function saveQueue() {
  safeWriteJson(state.queuePath, state.offlineQueue.serialize());
}

// ========== 命令处理器 ==========

async function handleVerifyCommand(query) {
  if (!query || !query.trim()) {
    return { content: [{ type: 'text', text: '❌ 请提供TxID或存证编号\n格式: 验证 <TxID或存证编号>' }] };
  }
  
  const searchQuery = query.trim().toUpperCase();
  let record = state.records.find(r => 
    r.attestId === searchQuery || (r.txId && r.txId.includes(searchQuery)) || r.batchId === searchQuery
  );
  
  if (!record) {
    const recentRecords = state.records.slice(-10);
    if (recentRecords.length > 0) record = recentRecords[recentRecords.length - 1];
  }
  
  if (!record) {
    return { content: [{ type: 'text', text: '❌ 未找到匹配的存证记录' }] };
  }
  
  let merkleValid = false;
  if (record.merkleRoot && record.merkleProof) {
    merkleValid = merkle.verifyMerkleProof(record.contentHash, record.merkleProof, record.merkleRoot);
  }
  
  return { content: [{ type: 'text', text: receipt.generateVerificationReport(record, merkleValid, record.txId ? '链上已锚定' : '待上链验证') }] };
}

async function handleCertificateCommand(attestId, regenerate) {
  let record;
  if (attestId && attestId.trim()) {
    const query = attestId.trim().toUpperCase();
    record = state.records.find(r => r.attestId === query || r.batchId === query);
  }
  if (!record && state.records.length > 0) record = state.records[state.records.length - 1];
  if (!record) return { content: [{ type: 'text', text: '❌ 未找到存证记录' }] };
  
  // 已上链且有txId则生成标准PDF证书
  const certPath = path.join(certificate.CERT_DIR, '存证证书_' + record.attestId + '.pdf');
  if (record.txId && (regenerate || !fs.existsSync(certPath))) {
    try {
      const sha256B64 = Buffer.from(record.contentHash || '', 'hex').toString('base64');
      const opReturnPayload = {
        m: 'MSLL',
        v: 1,
        r: (record.merkleRoot || record.contentHash || '').substring(0, 16),
        b: record.batchId || record.attestId,
        c: 1,
        t: record.timestamp || new Date().toISOString()
      };
      const pdfPath = certificate.generateCertificate({
        attestId: record.attestId,
        txId: record.txId,
        sha256Hex: record.contentHash || '',
        sha256B64: sha256B64,
        timestamp: record.timestamp || new Date().toISOString(),
        opReturn: opReturnPayload,
        filename: record.filename || ('record_' + record.attestId),
        fileSize: record.fileSize || 0,
        fileType: record.fileTypeDesc || record.category || '未知',
        address: state.config.bsvWallet
      });
      certificate.generateCertJson({
        attestId: record.attestId,
        txId: record.txId,
        sha256Hex: record.contentHash || '',
        sha256B64: sha256B64,
        timestamp: record.timestamp || new Date().toISOString(),
        opReturn: opReturnPayload,
        filename: record.filename || ('record_' + record.attestId),
        fileSize: record.fileSize || 0,
        fileType: record.fileTypeDesc || record.category || '未知',
        address: state.config.bsvWallet
      });
      return {
        content: [{ type: 'text', text: [
          '📄 存证证书已生成: ' + record.attestId,
          '',
          '═══ 存证信息 ═══',
          '🆔 ' + record.attestId,
          '📁 ' + (record.filename || '未知'),
          '🔗 TxID: ' + record.txId.substring(0, 16) + '...',
          '🔐 SHA-256: ' + (record.contentHash || '').substring(0, 16) + '...',
          '',
          '📎 证书文件: 存证证书/' + path.basename(pdfPath),
          '🌐 链上验证: https://whatsonchain.com/tx/' + record.txId
        ].join('\\n') }]
      };
    } catch (e) {
      console.error('[MingSeal] 证书生成失败:', e.message);
    }
  }
  
  // 无txId或生成失败则回退到文本收据
  let receiptText;
  if (record.type === 'image') {
    receiptText = receipt.generateImageReceipt(record);
  } else {
    receiptText = [
      receipt.generateTextReceipt(record),
      '',
      '═══════════════════════════════',
      '📋 JSON导出数据:',
      '═══════════════════════════════',
      receipt.exportToJson(record)
    ].join('\\n');
  }
  
  return { content: [{ type: 'text', text: receiptText }] };
}

async function handleStatusCommand() {
  const pendingCount = state.conversationBuffer.length;
  const queueCount = state.offlineQueue.size();
  const totalRecords = state.records.length;
  const anchoredCount = state.records.filter(r => r.txId).length;
  const imageRecords = state.records.filter(r => r.type === 'image').length;
  
  return { content: [{ type: 'text', text: [
    '📊 铭印存证状态报告',
    '═══════════════════════════════',
    `总存证数：${totalRecords} 条`,
    `  └─ 图片存证：${imageRecords} 条`,
    `  └─ 文本存证：${totalRecords - imageRecords} 条`,
    `已上链：${anchoredCount} 条`,
    `待处理缓冲区：${pendingCount} 条`,
    `待签名批次：${queueCount} 个`,
    '',
    '⚡ 自动存证：' + (state.config.autoAttest ? '✅ 开启' : '❌ 关闭'),
    `⏱️ 批量阈值：${state.config.batchSize} 条`,
    `🌐 BSV网络：${state.config.network}`,
    '═══════════════════════════════',
    `💼 钱包：${state.config.bsvWallet.substring(0, 8)}...`
  ].join('\n') }] };
}

// ========== 导出 ==========

module.exports = { init, register };
