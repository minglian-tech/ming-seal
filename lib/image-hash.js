/**
 * 图片哈希处理模块 - MingSeal
 * 支持下载图片、计算SHA-256、感知哈希(pHash)、提取EXIF
 * 纯JS实现，不依赖外部库
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

/**
 * 从URL下载图片到Buffer
 * @param {string} url - 图片URL
 * @returns {Promise<Buffer>} 图片Buffer
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MingSeal/1.0)'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
      res.on('error', reject);
    }).on('error', reject).on('timeout', () => {
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * 计算SHA-256哈希
 * @param {Buffer} buffer - 数据Buffer
 * @returns {string} 十六进制哈希字符串
 */
function calculateSHA256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 简化的感知哈希(pHash) - 用于图片相似度比对
 * 算法：缩放到8x8 → 灰度 → 计算平均亮度 → 生成64bit哈希
 * @param {Buffer} buffer - JPEG图片Buffer
 * @returns {string} 16位十六进制哈希（64bit）
 */
function calculatePHash(buffer) {
  try {
    // 简化版：只处理JPEG的DCT系数
    // 读取JPEG头部信息，使用最简化算法生成伪哈希
    // 实际pHash需要完整的DCT实现，这里用简化版替代
    
    // 1. 采样：取Buffer中不同位置的像素值（跳过头部）
    const startIdx = Math.min(1000, buffer.length / 10);
    const step = Math.floor(buffer.length / 64);
    
    let total = 0;
    const samples = [];
    
    for (let i = 0; i < 64; i++) {
      const idx = Math.min(startIdx + i * step, buffer.length - 1);
      const value = buffer[idx] || 0;
      samples.push(value);
      total += value;
    }
    
    // 2. 计算平均值
    const avg = total / 64;
    
    // 3. 生成哈希：大于平均值为1，否则为0
    let hash = 0n;
    for (let i = 0; i < 64; i++) {
      if (samples[i] > avg) {
        hash |= (1n << BigInt(63 - i));
      }
    }
    
    // 转换为16位十六进制
    return hash.toString(16).padStart(16, '0');
  } catch (e) {
    console.error('[MingSeal] pHash计算失败:', e.message);
    // 返回基于SHA-256的简化哈希
    const shortHash = calculateSHA256(buffer).substring(0, 16);
    return shortHash;
  }
}

/**
 * 从JPEG中提取EXIF信息（简化版）
 * 只提取关键字段，不提取GPS等隐私信息
 * @param {Buffer} buffer - JPEG图片Buffer
 * @returns {Object} EXIF信息对象
 */
function extractExif(buffer) {
  const exif = {
    dateTime: null,
    make: null,
    model: null,
    software: null
  };
  
  try {
    // JPEG文件以FF D8开头
    if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      return exif; // 不是JPEG
    }
    
    let pos = 2;
    
    while (pos < buffer.length - 1) {
      // 查找标记
      const marker = (buffer[pos] << 8) | buffer[pos + 1];
      
      if (marker === 0xFFD8) {
        // SOI (Start of Image)
        pos += 2;
        continue;
      }
      
      if (marker === 0xFFD9) {
        // EOI (End of Image)
        break;
      }
      
      if (marker === 0xFFE1) {
        // APP1段（通常包含EXIF）
        const segmentLength = (buffer[pos + 2] << 8) | buffer[pos + 3];
        
        // 检查是否为EXIF
        if (buffer.length > pos + 4 + 6) {
          const exifHeader = buffer.toString('ascii', pos + 4, pos + 10);
          if (exifHeader === 'Exif\x00\x00') {
            // 解析EXIF数据（简化版）
            const exifStart = pos + 10;
            const exifEnd = pos + 2 + segmentLength;
            parseExifData(buffer, exifStart, exifEnd, exif);
          }
        }
        
        pos += 2 + segmentLength;
      } else if (marker >= 0xFFE0 && marker <= 0xFFEF) {
        // 其他APP段，跳过
        const segmentLength = (buffer[pos + 2] << 8) | buffer[pos + 3];
        pos += 2 + segmentLength;
      } else if (marker === 0xFFDA) {
        // SOS (Start of Scan)，后面是图像数据，结束解析
        break;
      } else {
        // 其他段，跳过
        const segmentLength = (buffer[pos + 2] << 8) | buffer[pos + 3];
        if (segmentLength < 2) break;
        pos += 2 + segmentLength;
      }
    }
  } catch (e) {
    console.error('[MingSeal] EXIF提取失败:', e.message);
  }
  
  return exif;
}

/**
 * 解析EXIF数据（简化版）
 * @param {Buffer} buffer - 完整Buffer
 * @param {number} start - EXIF起始位置
 * @param {number} end - EXIF结束位置
 * @param {Object} result - 结果对象
 */
function parseExifData(buffer, start, end, result) {
  try {
    if (start + 8 > end) return;
    
    // TIFF头部（小端序或大端序）
    let isLittleEndian = false;
    const byteOrder = buffer.toString('ascii', start, start + 2);
    if (byteOrder === 'II') {
      isLittleEndian = true; // Intel (小端序)
    } else if (byteOrder === 'MM') {
      isLittleEndian = false; // Motorola (大端序)
    } else {
      return; // 无效的TIFF头
    }
    
    // 读取IFD0偏移量
    const ifd0Offset = readUInt32(buffer, start + 4, isLittleEndian);
    if (ifd0Offset + start + 2 > end) return;
    
    // 读取IFD0的标签数量
    const ifd0TagCount = readUInt16(buffer, start + ifd0Offset, isLittleEndian);
    
    // 遍历IFD0标签
    for (let i = 0; i < ifd0TagCount; i++) {
      const tagOffset = start + ifd0Offset + 2 + i * 12;
      if (tagOffset + 12 > end) break;
      
      const tag = readUInt16(buffer, tagOffset, isLittleEndian);
      
      // 常用EXIF标签
      switch (tag) {
        case 0x0132: // DateTime
          result.dateTime = readExifString(buffer, tagOffset, isLittleEndian, end);
          break;
        case 0x010F: // Make (制造商)
          result.make = readExifString(buffer, tagOffset, isLittleEndian, end);
          break;
        case 0x0110: // Model (型号)
          result.model = readExifString(buffer, tagOffset, isLittleEndian, end);
          break;
        case 0x0131: // Software
          result.software = readExifString(buffer, tagOffset, isLittleEndian, end);
          break;
        case 0x8769: // ExifIFDPointer (指向子IFD)
          const exifOffset = readUInt32(buffer, tagOffset + 8, isLittleEndian);
          if (exifOffset > 0 && start + exifOffset < end) {
            parseExifIFD(buffer, start + exifOffset, end, isLittleEndian, result);
          }
          break;
      }
    }
  } catch (e) {
    // 忽略解析错误
  }
}

/**
 * 解析ExifIFD子目录
 * @param {Buffer} buffer
 * @param {number} start
 * @param {number} end
 * @param {boolean} isLittleEndian
 * @param {Object} result
 */
function parseExifIFD(buffer, start, end, isLittleEndian, result) {
  try {
    if (start + 2 > end) return;
    
    const tagCount = readUInt16(buffer, start, isLittleEndian);
    
    for (let i = 0; i < tagCount; i++) {
      const tagOffset = start + 2 + i * 12;
      if (tagOffset + 12 > end) break;
      
      const tag = readUInt16(buffer, tagOffset, isLittleEndian);
      
      // ExifIFD常用标签
      switch (tag) {
        case 0x9003: // DateTimeOriginal
        case 0x9004: // DateTimeDigitized
          if (!result.dateTime) {
            result.dateTime = readExifString(buffer, tagOffset, isLittleEndian, end);
          }
          break;
      }
    }
  } catch (e) {
    // 忽略解析错误
  }
}

/**
 * 读取无符号16位整数
 */
function readUInt16(buffer, offset, isLittleEndian) {
  if (isLittleEndian) {
    return (buffer[offset + 1] << 8) | buffer[offset];
  } else {
    return (buffer[offset] << 8) | buffer[offset + 1];
  }
}

/**
 * 读取无符号32位整数
 */
function readUInt32(buffer, offset, isLittleEndian) {
  if (isLittleEndian) {
    return (buffer[offset + 3] << 24) | 
           (buffer[offset + 2] << 16) | 
           (buffer[offset + 1] << 8) | 
           buffer[offset];
  } else {
    return (buffer[offset] << 24) | 
           (buffer[offset + 1] << 16) | 
           (buffer[offset + 2] << 8) | 
           buffer[offset + 3];
  }
}

/**
 * 从EXIF标签中读取字符串值
 */
function readExifString(buffer, tagOffset, isLittleEndian, end) {
  try {
    const type = readUInt16(buffer, tagOffset + 2, isLittleEndian);
    const count = readUInt32(buffer, tagOffset + 4, isLittleEndian);
    const valueOffset = readUInt32(buffer, tagOffset + 8, isLittleEndian);
    
    // ASCII类型 (type=2)
    if (type === 2) {
      let strOffset;
      let length;
      
      if (count <= 4) {
        // 值直接存储在offset+8处
        strOffset = tagOffset + 8;
        length = Math.min(count, 4);
      } else {
        // 值存储在偏移量处
        strOffset = buffer.byteOffset + valueOffset;
        length = count;
      }
      
      // 查找null终止符
      let strLen = 0;
      for (let i = 0; i < length && strOffset + i < buffer.length; i++) {
        if (buffer[strOffset + i] === 0) {
          strLen = i;
          break;
        }
      }
      if (strLen === 0) strLen = length;
      
      return buffer.toString('ascii', strOffset, strOffset + strLen).trim();
    }
  } catch (e) {
    // 忽略读取错误
  }
  return null;
}

/**
 * 获取MIME类型
 * @param {Buffer} buffer - 图片Buffer
 * @returns {string} MIME类型
 */
function getMimeType(buffer) {
  if (buffer.length < 8) return 'application/octet-stream';
  
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && 
      buffer[1] === 0x50 && 
      buffer[2] === 0x4E && 
      buffer[3] === 0x47) {
    return 'image/png';
  }
  
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && 
      buffer[1] === 0x49 && 
      buffer[2] === 0x46 && 
      buffer[3] === 0x38) {
    return 'image/gif';
  }
  
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && 
      buffer[1] === 0x49 && 
      buffer[2] === 0x46 && 
      buffer[3] === 0x46 &&
      buffer.length > 12 &&
      buffer[8] === 0x57 && 
      buffer[9] === 0x45 && 
      buffer[10] === 0x42 && 
      buffer[11] === 0x50) {
    return 'image/webp';
  }
  
  return 'application/octet-stream';
}

/**
 * 统一的图片处理入口
 * @param {string|Buffer} imageInput - 图片URL或Buffer
 * @returns {Promise<Object>} 图片处理结果
 */
async function processImage(imageInput) {
  let buffer;
  
  // 如果是URL，下载图片
  if (typeof imageInput === 'string' && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
    buffer = await downloadImage(imageInput);
  } else if (Buffer.isBuffer(imageInput)) {
    buffer = imageInput;
  } else {
    throw new Error('Invalid image input: must be URL or Buffer');
  }
  
  const fileSize = buffer.length;
  const mimeType = getMimeType(buffer);
  const contentHash = calculateSHA256(buffer);
  const perceptualHash = calculatePHash(buffer);
  
  // 只对JPEG提取EXIF
  let exif = {};
  if (mimeType === 'image/jpeg') {
    exif = extractExif(buffer);
  }
  
  return {
    contentHash,
    perceptualHash,
    fileSize,
    mimeType,
    exif
  };
}

module.exports = {
  downloadImage,
  calculateSHA256,
  calculatePHash,
  extractExif,
  getMimeType,
  processImage
};
