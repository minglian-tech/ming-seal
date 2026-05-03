/**
 * 数据脱敏模块 - MingSeal
 * 处理敏感信息：手机号、邮箱、身份证、银行卡、地址等
 */

// 脱敏规则定义
const SANITIZE_PATTERNS = {
  // 手机号: 138****1234
  phone: /(\d{3})\d{4}(\d{4})/g,
  
  // 邮箱: u***@domain.com
  email: /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
  
  // 身份证: 3***********1234
  idCard: /(\d{3})\d{11}(\d{4})/g,
  
  // 银行卡: ****1234
  bankCard: /\d{13,19}/g,
  
  // 地址: 保留省市，其余***
  address: /(.*?(?:省|市|自治区|特别行政区))(.*)/g,
  
  // 密码相关字段
  password: /(password|pwd|passwd|secret|token|api[_-]?key)[=:]\s*(["']?)([^"'\s,}]+)\2/gi,
  
  // 通用敏感key-value
  sensitiveKV: /("(?:password|token|secret|key|pin|pwd|pass|authorization|private[_-]?key)")\s*:\s*("[^"]*")/gi
};

/**
 * 脱敏手机号
 * @param {string} phone - 原始手机号
 * @returns {string} 脱敏后的手机号
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return phone;
  return phone.replace(/(\d{3})\d{4}(\d{4})/g, '$1****$2');
}

/**
 * 脱敏邮箱
 * @param {string} email - 原始邮箱
 * @returns {string} 脱敏后的邮箱
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  return email.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, (match, user, domain) => {
    const maskedUser = user.charAt(0) + '***';
    return maskedUser + '@' + domain;
  });
}

/**
 * 脱敏身份证号
 * @param {string} idCard - 原始身份证号
 * @returns {string} 脱敏后的身份证号
 */
function maskIdCard(idCard) {
  if (!idCard || typeof idCard !== 'string') return idCard;
  return idCard.replace(/(\d{3})\d{11}(\d{4})/g, '$1***********$2');
}

/**
 * 脱敏银行卡号
 * @param {string} bankCard - 原始银行卡号
 * @returns {string} 脱敏后的银行卡号
 */
function maskBankCard(bankCard) {
  if (!bankCard || typeof bankCard !== 'string') return bankCard;
  return '****' + bankCard.slice(-4);
}

/**
 * 脱敏地址（保留省市）
 * @param {string} address - 原始地址
 * @returns {string} 脱敏后的地址
 */
function maskAddress(address) {
  if (!address || typeof address !== 'string') return address;
  // 提取省市部分
  const provinceCityMatch = address.match(/(.*?(?:省|市|自治区|特别行政区|州|郡))/);
  if (provinceCityMatch) {
    return provinceCityMatch[1] + '***';
  }
  return address.substring(0, 10) + '***';
}

/**
 * 通用脱敏函数
 * @param {*} obj - 待脱敏对象
 * @param {string[]} rules - 脱敏规则数组
 * @returns {*} 脱敏后的对象
 */
function sanitize(obj, rules) {
  if (obj === null || obj === undefined) return null;
  
  // 处理字符串
  if (typeof obj === 'string') {
    let result = obj;
    
    // 应用规则
    for (const rule of rules) {
      try {
        // 处理特殊规则
        if (rule === 'phone' || rule === 'mobile' || rule === 'tel') {
          result = maskPhone(result);
        } else if (rule === 'email') {
          result = maskEmail(result);
        } else if (rule === 'id_card' || rule === 'id_number' || rule === 'idcard') {
          result = maskIdCard(result);
        } else if (rule === 'bank_card' || rule === 'credit_card') {
          result = maskBankCard(result);
        } else if (rule === 'address') {
          result = maskAddress(result);
        } else {
          // 通用正则规则
          const regex = new RegExp(rule, 'gi');
          result = result.replace(regex, '***');
        }
      } catch (e) {
        // 忽略无效正则
      }
    }
    return result;
  }
  
  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item, rules));
  }
  
  // 处理对象
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // 检查key是否匹配敏感规则
      let isSensitiveKey = false;
      for (const rule of rules) {
        try {
          // 提取规则中的key名称（去掉正则特殊字符）
          const keyPattern = rule.replace(/[()[\]{}*+?.\\^$|]/g, '');
          if (key.toLowerCase().includes(keyPattern.toLowerCase())) {
            isSensitiveKey = true;
            break;
          }
        } catch (e) {}
      }
      
      if (isSensitiveKey && typeof value === 'string') {
        result[key] = '***';
      } else if (isSensitiveKey && typeof value === 'object') {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitize(value, rules);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * 深度脱敏 - 专门处理对话内容
 * @param {Object} conversationData - 对话数据
 * @param {string[]} rules - 脱敏规则
 * @returns {Object} 脱敏后的数据
 */
function deepSanitize(conversationData, rules = []) {
  // 默认规则
  const defaultRules = rules.length > 0 ? rules : [
    'phone', 'mobile', 'tel',
    'email',
    'id_card', 'id_number', 'idcard',
    'bank_card', 'credit_card',
    'address',
    'password', 'pwd', 'passwd', 'secret', 'token',
    'api_key', 'api-key', 'private_key', 'private-key',
    'authorization', 'bearer', 'x-api-key'
  ];
  
  // 如果是字符串，直接脱敏
  if (typeof conversationData === 'string') {
    return sanitize(conversationData, defaultRules);
  }
  
  // 如果是对象，递归脱敏
  if (typeof conversationData === 'object') {
    return sanitize(conversationData, defaultRules);
  }
  
  return conversationData;
}

module.exports = {
  maskPhone,
  maskEmail,
  maskIdCard,
  maskBankCard,
  maskAddress,
  sanitize,
  deepSanitize,
  SANITIZE_PATTERNS
};
