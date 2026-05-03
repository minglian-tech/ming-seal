/**
 * Merkle树模块 - MingSeal
 * 构建与验证Merkle树，用于批量记录聚合锚定
 */

const crypto = require('crypto');

/**
 * SHA-256哈希函数
 * @param {*} data - 待哈希数据（会自动JSON.stringify）
 * @returns {string} 十六进制哈希字符串
 */
function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data), 'utf8').digest('hex');
}

/**
 * 双重SHA-256哈希（Bitcoin风格）
 * @param {string} data - 待哈希字符串
 * @returns {string} 双重哈希结果
 */
function doubleSha256(data) {
  return crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(data, 'utf8').digest()
  ).digest('hex');
}

/**
 * 从叶子节点数组构建Merkle树
 * @param {string[]} leaves - 十六进制哈希数组
 * @returns {{ root: string|null, proofs: Object, tree: string[][] }}
 */
function buildMerkleTree(leaves) {
  if (leaves.length === 0) {
    return { root: null, proofs: {}, tree: [] };
  }
  
  // 单叶子时，根即为叶子本身
  if (leaves.length === 1) {
    return {
      root: leaves[0],
      proofs: { [leaves[0]]: [] },
      tree: [leaves]
    };
  }

  // 记录每个节点的父节点信息（用于生成proof）
  const parentMap = new Map();
  let currentLevel = [...leaves];
  const tree = [currentLevel];

  let levelIndex = 0;

  while (currentLevel.length > 1) {
    const nextLevel = [];
    
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || currentLevel[i]; // 奇数个时填充自身
      
      // Bitcoin风格：先翻转再哈希（Little-endian）
      const combined = left + right;
      const parent = sha256(combined);
      
      nextLevel.push(parent);
      
      // 记录父子关系
      parentMap.set(left, { parent, sibling: right, side: 'left', level: levelIndex });
      parentMap.set(right, { parent, sibling: left, side: 'right', level: levelIndex });
    }
    
    currentLevel = nextLevel;
    tree.push(currentLevel);
    levelIndex++;
  }

  const root = currentLevel[0];

  // 为每个叶子节点构建Merkle proof
  const proofs = {};
  for (const leaf of leaves) {
    const proof = [];
    let node = leaf;
    
    while (parentMap.has(node)) {
      const info = parentMap.get(node);
      proof.push({ side: info.side, hash: info.sibling });
      node = info.parent;
    }
    
    proofs[leaf] = proof;
  }

  return { root, proofs, tree };
}

/**
 * 验证Merkle proof
 * @param {string} leafHash - 待验证的叶子哈希
 * @param {Array<{side: string, hash: string}>} proof - Merkle证明路径
 * @param {string} root - Merkle根
 * @returns {boolean}
 */
function verifyMerkleProof(leafHash, proof, root) {
  let currentHash = leafHash;
  
  for (const p of proof) {
    const combined = p.side === 'left'
      ? currentHash + p.hash
      : p.hash + currentHash;
    currentHash = sha256(combined);
  }
  
  return currentHash === root;
}

/**
 * 计算批量聚合的Merkle根
 * @param {Array<Object>} records - 记录数组
 * @returns {{ merkleRoot: string, hashes: string[], proofs: Object }}
 */
function batchMerkleRoot(records) {
  // 对每条记录生成哈希
  const hashes = records.map(record => sha256(record));
  
  // 构建Merkle树
  const { root, proofs } = buildMerkleTree(hashes);
  
  return {
    merkleRoot: root,
    hashes,
    proofs
  };
}

/**
 * 生成批量存证的Merkle聚合数据
 * @param {Array<Object>} records - 待聚合记录
 * @param {number} batchSize - 批次大小
 * @returns {Array<{batchId: string, records: Array, merkleRoot: string, hashes: string[]}>}
 */
function createBatches(records, batchSize = 100) {
  const batches = [];
  
  for (let i = 0; i < records.length; i += batchSize) {
    const batchRecords = records.slice(i, i + batchSize);
    const { merkleRoot, hashes, proofs } = batchMerkleRoot(batchRecords);
    
    batches.push({
      batchId: generateBatchId(),
      records: batchRecords,
      merkleRoot,
      hashes,
      proofs,
      recordCount: batchRecords.length,
      timestamp: new Date().toISOString()
    });
  }
  
  return batches;
}

/**
 * 生成批次ID
 * @returns {string}
 */
function generateBatchId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `MSB-${timestamp}-${random}`.toUpperCase();
}

/**
 * 验证批量存证
 * @param {Object} record - 单条原始记录
 * @param {string} merkleRoot - 批次Merkle根
 * @param {Array<{side: string, hash: string}>} proof - 该记录的Merkle proof
 * @returns {boolean}
 */
function verifyBatchAttestation(record, merkleRoot, proof) {
  const hash = sha256(record);
  return verifyMerkleProof(hash, proof, merkleRoot);
}

module.exports = {
  sha256,
  doubleSha256,
  buildMerkleTree,
  verifyMerkleProof,
  batchMerkleRoot,
  createBatches,
  generateBatchId,
  verifyBatchAttestation
};
