/**
 * MingSeal 测试脚本
 */

const MingSeal = require('../index');

// 测试配置
const testConfig = {
  bsvWif: process.env.MINGSEAL_BSV_WIF || '5KiMhXRP4Gm3P9qhpw1p41ea227CQDYSAcLhXDgwyrcC7YQqCz8', // 仅用于测试
  batchSize: 10,
  network: 'testnet',
  workspaceDir: './test-data'
};

async function runTests() {
  console.log('🧪 MingSeal 测试开始\n');
  
  // 测试1: 基本初始化
  console.log('测试 1: 初始化...');
  try {
    const seal = new MingSeal(testConfig);
    console.log('✅ 初始化成功\n');
  } catch (e) {
    console.log('❌ 初始化失败:', e.message, '\n');
    return;
  }
  
  // 测试2: 存证功能（不实际签名广播）
  console.log('测试 2: 存证功能...');
  try {
    const seal = new MingSeal(testConfig);
    // 模拟存证
    const result = await seal.attest({
      type: 'test',
      content: '这是一条测试存证'
    });
    console.log('✅ 存证成功:', result.id, '\n');
  } catch (e) {
    console.log('❌ 存证失败:', e.message, '\n');
  }
  
  console.log('✅ 测试完成');
}

runTests().catch(console.error);
