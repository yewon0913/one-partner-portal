const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 5001;
const DATA_FILE = path.join(__dirname, 'data.json');
const LEAD_DATA_FILE = path.join(__dirname, 'lead-data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Ensure directories/files exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
if (!fs.existsSync(LEAD_DATA_FILE)) fs.writeFileSync(LEAD_DATA_FILE, '[]');
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ telegramBotToken: '', telegramChatId: '' }));

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
};

function readData(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

function writeData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { telegramBotToken: '', telegramChatId: '' }; }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Telegram notification
function sendTelegramNotification(message) {
  const config = readConfig();
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const postData = JSON.stringify({
    chat_id: config.telegramChatId,
    text: message,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${config.telegramBotToken}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ 텔레그램 알림 전송 성공');
      } else {
        console.log('❌ 텔레그램 알림 전송 실패:', body);
      }
    });
  });
  req.on('error', e => console.log('❌ 텔레그램 오류:', e.message));
  req.write(postData);
  req.end();
}

// Parse multipart form data
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from('--' + boundary);

  let start = buffer.indexOf(boundaryBuf) + boundaryBuf.length + 2;

  while (start < buffer.length) {
    const end = buffer.indexOf(boundaryBuf, start);
    if (end === -1) break;

    const part = buffer.slice(start, end - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = end + boundaryBuf.length + 2; continue; }

    const headerStr = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: fileMatch ? fileMatch[1] : null,
        data: body,
        isFile: !!fileMatch,
      });
    }

    start = end + boundaryBuf.length + 2;
  }

  return parts;
}

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ===== API: Submit Lead (1차 리드 생성) =====
  if (req.method === 'POST' && url.pathname === '/api/submit-lead') {
    parseBody(req).then(body => {
      const submission = {
        id: Date.now(),
        ...body,
        type: 'lead',
        submittedAt: body.submittedAt || new Date().toLocaleString('ko-KR')
      };

      const data = readData(LEAD_DATA_FILE);
      data.push(submission);
      writeData(LEAD_DATA_FILE, data);

      console.log(`\n📋 새로운 1차 리드 접수!`);
      console.log(`   업종: ${submission.industry}`);
      console.log(`   업체명: ${submission.companyName}`);
      console.log(`   성함: ${submission.contactName}`);
      console.log(`   연락처: ${submission.contactPhone}\n`);

      // Telegram notification
      sendTelegramNotification(
        `🔔 <b>새로운 정책자금 진단 신청</b>\n\n` +
        `📌 업종: ${submission.industry}\n` +
        `📍 지역: ${submission.region}\n` +
        `🏢 업체명: ${submission.companyName}\n` +
        `💰 희망자금: ${submission.fundingAmount}\n` +
        `👤 성함: ${submission.contactName}\n` +
        `📞 연락처: ${submission.contactPhone}\n` +
        `⏰ 통화시간: ${submission.preferredTime}\n` +
        `📅 접수시간: ${submission.submittedAt}`
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, id: submission.id }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // ===== API: Submit Diagnosis (2차 정밀 진단) =====
  if (req.method === 'POST' && url.pathname === '/api/submit') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';

        let formDataObj = {};
        let savedFiles = {};

        if (contentType.includes('multipart/form-data')) {
          const boundary = contentType.split('boundary=')[1];
          const parts = parseMultipart(buffer, boundary);

          for (const part of parts) {
            if (part.isFile && part.filename) {
              const ext = path.extname(part.filename) || '.bin';
              const safeName = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
              const filePath = path.join(UPLOADS_DIR, safeName);
              fs.writeFileSync(filePath, part.data);
              savedFiles[part.name] = safeName;
            } else if (part.name === 'data') {
              formDataObj = JSON.parse(part.data.toString());
            }
          }
        } else {
          formDataObj = JSON.parse(buffer.toString());
        }

        const submission = {
          id: Date.now(),
          ...formDataObj,
          type: 'diagnosis',
          bizFileServer: savedFiles.bizFile || null,
          creditFileServer: savedFiles.creditFile || null,
          submittedAt: formDataObj.submittedAt || new Date().toLocaleString('ko-KR'),
        };

        const data = readData(DATA_FILE);
        data.push(submission);
        writeData(DATA_FILE, data);

        console.log(`\n📋 새로운 정밀 진단 서류 접수!`);
        console.log(`   직원 수: ${submission.employeeCount}명`);
        console.log(`   신용점수: ${submission.creditScore}점`);
        console.log(`   연체: ${submission.overdue}`);
        console.log(`   접수시간: ${submission.submittedAt}\n`);

        // Telegram notification
        const govLoansText = submission.govLoans && submission.govLoans.length > 0
          ? submission.govLoans.map((l, i) => `  ${i+1}. ${l.institution} / ${l.date} / ${l.amount}만원`).join('\n')
          : '없음';

        sendTelegramNotification(
          `🔔 <b>새로운 정밀 진단 서류 접수</b>\n\n` +
          `👥 직원 수: ${submission.employeeCount}명\n` +
          `💵 매출(23/24/25): ${submission.revenue2023} / ${submission.revenue2024} / ${submission.revenue2025} 만원\n` +
          `📊 신용점수: ${submission.creditScore}점\n` +
          `⚠️ 연체: ${submission.overdue}\n` +
          `🏦 정부대출: ${submission.govLoan}\n` +
          `${submission.govLoan === '있음' ? '📋 대출내역:\n' + govLoansText + '\n' : ''}` +
          `💳 기타대출: ${submission.otherLoans || '없음'}\n` +
          `📅 접수시간: ${submission.submittedAt}`
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: submission.id }));
      } catch (err) {
        console.error('Submit error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ===== API: Get submissions (2차 정밀 진단) =====
  if (req.method === 'GET' && url.pathname === '/api/submissions') {
    const data = readData(DATA_FILE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // ===== API: Get leads (1차 리드) =====
  if (req.method === 'GET' && url.pathname === '/api/leads') {
    const data = readData(LEAD_DATA_FILE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // ===== API: Delete submission =====
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/submissions/')) {
    const id = parseInt(url.pathname.split('/').pop());
    let data = readData(DATA_FILE);
    data = data.filter(s => s.id !== id);
    writeData(DATA_FILE, data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ===== API: Delete lead =====
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/leads/')) {
    const id = parseInt(url.pathname.split('/').pop());
    let data = readData(LEAD_DATA_FILE);
    data = data.filter(s => s.id !== id);
    writeData(LEAD_DATA_FILE, data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ===== API: Telegram config =====
  if (req.method === 'GET' && url.pathname === '/api/telegram-config') {
    const config = readConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasToken: !!config.telegramBotToken,
      hasChatId: !!config.telegramChatId
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/telegram-config') {
    parseBody(req).then(body => {
      const config = readConfig();
      if (body.botToken !== undefined) config.telegramBotToken = body.botToken;
      if (body.chatId !== undefined) config.telegramChatId = body.chatId;
      writeConfig(config);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/telegram-test') {
    sendTelegramNotification('🔔 <b>테스트 알림</b>\n\nONE PARTNER 관리자 알림이 정상적으로 연결되었습니다!');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ===== Static files =====
  let filePath = url.pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, url.pathname);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ONE PARTNER 통합 서버 실행 중`);
  console.log(`   1차 리드 생성: http://localhost:${PORT}/lead-gen.html`);
  console.log(`   2차 정밀 진단: http://localhost:${PORT}/`);
  console.log(`   관리자 대시보드: http://localhost:${PORT}/admin.html`);
  console.log(`   관리자 비밀번호: onepartner2026\n`);
});
