/**
 * BSV OP_RETURN锚定模块 — MingSeal
 * 
 * 完整签名+广播管线：
 *   hashForWitnessV0（BIP143）计算sighash → secp256k1 ECDSA签名 → 强制低S → 广播whatsonchain
 * 
 * 依赖（已预装，在插件package.json中）：
 *   bitcoinjs-lib, ecpair, tiny-secp256k1, secp256k1
 */

const crypto = require('crypto');
const https = require('https');
const secp256k1 = require('secp256k1');
const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const tinysecp = require('tiny-secp256k1');

// ===== 协议常量 =====
const PROTOCOL = { IDENTIFIER: 'MSLL', VERSION: 0x01 };
const SIGHASH_FORKID = 0x41;
const HALF_ORDER = Buffer.from(
  '7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0', 'hex'
);
const CURVE_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

// ===== 哈希工具 =====
function doubleSHA256(buf) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}
function hash160(data) {
  return crypto.createHash('ripemd160').update(crypto.createHash('sha256').update(data).digest()).digest();
}

// ===== Base58(Check) =====
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
  const r = [];
  for (let i = 0; i < str.length; i++) {
    let c = ALPHABET.indexOf(str[i]);
    if (c < 0) throw new Error('Invalid char: ' + str[i]);
    for (let j = 0; j < r.length; j++) { c += r[j] * 58; r[j] = c & 0xff; c >>= 8; }
    while (c > 0) { r.push(c & 0xff); c >>= 8; }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) r.push(0);
  return Buffer.from(r.reverse());
}

function base58Encode(buf) {
  const r = [];
  for (const b of buf) {
    let c = b;
    for (let j = 0; j < r.length; j++) { c += r[j] * 256; r[j] = c % 58; c = Math.floor(c / 58); }
    while (c > 0) { r.push(c % 58); c = Math.floor(c / 58); }
  }
  for (let i = 0; i < buf.length && buf[i] === 0; i++) r.push(0);
  return r.reverse().map(i => ALPHABET[i]).join('');
}

function base58CheckDecode(str) {
  const d = base58Decode(str);
  if (d.length < 5) throw new Error('Too short');
  const p = d.slice(0, -4), ck = d.slice(-4);
  if (!doubleSHA256(p).slice(0, 4).equals(ck)) throw new Error('Checksum mismatch');
  return p;
}

function base58CheckEncode(payload) {
  return base58Encode(Buffer.concat([payload, doubleSHA256(payload).slice(0, 4)]));
}

// ===== WIF ⇒ 地址 & 密钥 =====
function parseWIF(wif) {
  const decoded = base58CheckDecode(wif);
  if (decoded[0] !== 0x80) throw new Error('WIF version byte: 0x' + decoded[0].toString(16));
  let pk, compressed;
  if (decoded.length === 34 && decoded[33] === 0x01) {
    pk = decoded.slice(1, 33); compressed = true;
  } else {
    pk = decoded.slice(1, 33); compressed = true; // 强制压缩
  }
  return { privateKey: pk, compressed };
}

function wifToAddress(wif) {
  const { privateKey, compressed } = parseWIF(wif);
  const pubkey = secp256k1.publicKeyCreate(privateKey, compressed);
  return base58CheckEncode(Buffer.concat([Buffer.from([0x00]), hash160(pubkey)]));
}

function wifToKeyPair(wif) {
  return ECPairFactory(tinysecp).fromWIF(wif, bitcoin.networks.bitcoin);
}

// ===== P2PKH脚本工具 =====
function p2pkhOutputScript(pubkeyHex) {
  const pubkey = Buffer.from(pubkeyHex, 'hex');
  return bitcoin.payments.p2pkh({ pubkey }).output;
}

// ===== 低S强制修正 =====
function enforceLowS(sigRaw) {
  const s = sigRaw.subarray(32, 64);
  if (Buffer.compare(s, HALF_ORDER) > 0) {
    const sVal = BigInt('0x' + s.toString('hex'));
    const newS = CURVE_N - sVal;
    return Buffer.concat([
      sigRaw.subarray(0, 32),
      Buffer.from(newS.toString(16).padStart(64, '0'), 'hex')
    ]);
  }
  return sigRaw;
}

// ===== DER编码（小端r/s容错） =====
function derEncode(r, s) {
  if (r[0] & 0x80) r = Buffer.concat([Buffer.from([0x00]), r]);
  if (s[0] & 0x80) s = Buffer.concat([Buffer.from([0x00]), s]);
  return Buffer.concat([
    Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]), r,
    Buffer.from([0x02, s.length]), s
  ]);
}

// ===== 一站式签名：给定bitcoinjs交易 → 注入签名 =====
function signBitcoinJsTx(tx, inputIndex, satValue, wif) {
  const keyPair = wifToKeyPair(wif);
  const pk = keyPair.privateKey;
  const compressedPubkey = tinysecp.pointFromScalar(pk, true);
  const pubkey = Buffer.from(compressedPubkey);
  const p2pkh = bitcoin.payments.p2pkh({ pubkey });
  const scriptCode = p2pkh.output;

  // BIP143 sighash
  const sigHash = tx.hashForWitnessV0(inputIndex, scriptCode, BigInt(satValue), SIGHASH_FORKID);

  // ECDSA签名
  const sigObj = secp256k1.ecdsaSign(sigHash, pk);
  let sigRaw = Buffer.from(sigObj.signature);
  sigRaw = enforceLowS(sigRaw);

  // DER编码并附加sigHashType
  const derSig = derEncode(sigRaw.subarray(0, 32), sigRaw.subarray(32, 64));
  const sigWithType = Buffer.concat([derSig, Buffer.from([SIGHASH_FORKID])]);

  // 注入scriptSig
  tx.ins[inputIndex].script = bitcoin.script.compile([sigWithType, pubkey]);
  return tx;
}

// ===== 构建OP_RETURN交易并签名 =====
function buildOpReturnTx(prevTxHash, prevVout, satValue, changeAmount, wif, opReturnChunks) {
  const keyPair = wifToKeyPair(wif);
  const pk = keyPair.privateKey;
  const compressedPubkey = tinysecp.pointFromScalar(pk, true);
  const pubkey = Buffer.from(compressedPubkey);
  const p2pkh = bitcoin.payments.p2pkh({ pubkey });

  const tx = new bitcoin.Transaction();
  tx.version = 1;

  // 输入
  const prevHash = Buffer.from(prevTxHash, 'hex').reverse();
  tx.addInput(prevHash, prevVout, 0xffffffff);

  // OP_RETURN输出（BSV必须用OP_FALSE OP_RETURN，否则报dust）
  const opRetScript = bitcoin.script.compile([bitcoin.opcodes.OP_0, bitcoin.opcodes.OP_RETURN, ...opReturnChunks]);
  tx.addOutput(opRetScript, BigInt(0));

  // 找零输出
  tx.addOutput(p2pkh.output, BigInt(changeAmount));

  // 签名
  signBitcoinJsTx(tx, 0, satValue, wif);

  const hex = tx.toHex();
  const txId = tx.getId();
  return { tx, hex, txId, address: p2pkh.address };
}

// ===== Payload构建 =====
function buildMingSealPayload(merkleRoot, recordCount, metadata = {}) {
  return {
    m: PROTOCOL.IDENTIFIER,
    v: PROTOCOL.VERSION,
    r: merkleRoot ? merkleRoot.substring(0, 16) : 'test',
    b: Date.now().toString(36),
    c: recordCount || 1,
    t: new Date().toISOString(),
    ...metadata
  };
}

// ===== HTTPS工具 =====
function httpsGet(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function httpsPost(url, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, port: 443,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      timeout: timeoutMs
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(d)); } catch { resolve(d); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ===== UTXO获取 =====
async function fetchUTXOs(address) {
  const result = await httpsGet(`https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent`);
  if (!Array.isArray(result)) throw new Error('Invalid UTXO response');
  result.sort((a, b) => a.value - b.value);
  return result;
}

// ===== 广播（带重试） =====
async function broadcastTx(signedHex, maxRetries = 2) {
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await httpsPost(
        'https://api.whatsonchain.com/v1/bsv/main/tx/raw',
        { txhex: signedHex }
      );
      if (typeof result === 'object' && result !== null) {
        return { success: true, txId: result.txid || result.toString() };
      }
      return { success: true, txId: result.toString().trim() };
    } catch (e) {
      lastErr = e;
      if (i < maxRetries) await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

// ===== 一站式：签名+广播 =====
async function signAndBroadcast(wif, prevTxHash, prevVout, satValue, changeAmount, opReturnData, maxRetries) {
  const txData = buildOpReturnTx(prevTxHash, prevVout, satValue, changeAmount, wif, opReturnData);
  const result = await broadcastTx(txData.hex, maxRetries);
  return { ...txData, broadcast: result };
}

async function autoSignAndBroadcast(wif, opReturnData, metadata = {}) {
  const address = wifToAddress(wif);
  const utxos = await fetchUTXOs(address);
  if (!utxos.length) throw new Error('No UTXOs at ' + address);
  const utxo = utxos[0];
  const fee = 500;
  const change = utxo.value - fee;
  if (change < 546) throw new Error(`UTXO ${utxo.value} sat < fee+546`);
  return await signAndBroadcast(wif, utxo.tx_hash, utxo.tx_pos, utxo.value, change, opReturnData);
}

// ===== buildSignAndBroadcast（兼容旧processQueue调用） =====
async function buildSignAndBroadcast(merkleRoot, wif, recordCount, metadata = {}) {
  const payload = buildMingSealPayload(merkleRoot, recordCount, metadata);
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const address = wifToAddress(wif);
  const utxos = await fetchUTXOs(address);
  if (!utxos.length) throw new Error('No UTXOs at ' + address);
  const utxo = utxos[0];
  const fee = 500;
  const change = utxo.value - fee;
  if (change < 546) throw new Error('UTXO too small: ' + utxo.value);

  const txData = buildOpReturnTx(
    utxo.tx_hash, utxo.tx_pos, utxo.value, change,
    wif, [payloadBuf]
  );
  const result = await broadcastTx(txData.hex);
  return {
    signedHex: txData.hex,
    txId: txData.txId,
    broadcastTxId: result.txId,
    address,
    fee,
    change,
    utxoRef: utxo.tx_hash + ':' + utxo.tx_pos
  };
}

// ===== 旧API兼容 =====
function wifToAddress_old(wif) { return wifToAddress(wif); }

// ===== 导出 =====
module.exports = {
  PROTOCOL,
  parseWIF,
  wifToAddress,
  wifToKeyPair,
  buildOpReturnTx,
  signBitcoinJsTx,
  buildMingSealPayload,
  fetchUTXOs,
  broadcastTx,
  signAndBroadcast,
  autoSignAndBroadcast,
  buildSignAndBroadcast,
  // 保留旧API兼容
  wifToAddress: wifToAddress_old,
  // 工具
  hash160,
  doubleSHA256,
  base58CheckEncode,
  base58CheckDecode,
};
