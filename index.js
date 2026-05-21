const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const NodeCache = require('node-cache');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_NAME = process.env.BOT_NAME || 'Asistan';
const TRIGGER_WORD = (process.env.TRIGGER_WORD || '@asistan').toLowerCase();

if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY eksik!');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
const chatHistories = {};
const msgRetryCounterCache = new NodeCache();

const SYSTEM_PROMPT = `Sen "${BOT_NAME}" adında eğlenceli, zeki bir WhatsApp grup botusun. Türkçe konuşuyorsun. Kısa ve eğlenceli cevaplar ver.`;

async function getGeminiResponse(userId, userMessage) {
    try {
        if (!chatHistories[userId]) chatHistories[userId] = [];
        if (chatHistories[userId].length > 40) chatHistories[userId] = chatHistories[userId].slice(-20);

        const chat = model.startChat({
            history: chatHistories[userId],
            generationConfig: { maxOutputTokens: 500, temperature: 0.9 },
            systemInstruction: SYSTEM_PROMPT,
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response.text();

        chatHistories[userId].push(
            { role: 'user', parts: [{ text: userMessage }] },
            { role: 'model', parts: [{ text: response }] }
        );
        return response;
    } catch (error) {
        console.error('Gemini hatası:', error.message);
        return '😵 Bir hata oluştu, birazdan tekrar dene!';
    }
}

let retryCount = 0;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Baileys v${version.join('.')}, güncel: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        msgRetryCounterCache,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Bot', 'Safari', '1.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000,
        defaultQueryTimeoutMs: 60000,
        qrTimeout: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            retryCount = 0;
            console.log('\n\n======= QR KODU TARA =======\n');
            qrcode.generate(qr, { small: true });
            console.log('\nWhatsApp Business > 3 Nokta > Bağlı Cihazlar > Cihaz Ekle\n');
            console.log('============================\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            console.log(`Bağlantı kesildi. Kod: ${statusCode}`);

            if (isLoggedOut) {
                console.log('❌ Oturum sona erdi. auth_info klasörünü sil.');
                return;
            }

            retryCount++;
            const delay = Math.min(5000 * retryCount, 30000);
            console.log(`${delay/1000}sn sonra yeniden bağlanılıyor... (deneme ${retryCount})`);
            setTimeout(startBot, delay);

        } else if (connection === 'open') {
            retryCount = 0;
            console.log(`\n✅ ${BOT_NAME} bağlandı! Numara: ${sock.user?.id}\n`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            if (!msg.message) continue;

            const chatId = msg.key.remoteJid;
            const isGroup = chatId?.endsWith('@g.us');

            const messageContent =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption || '';

            if (!messageContent) continue;

            const lowerContent = messageContent.toLowerCase();
            const senderId = msg.key.participant || msg.key.remoteJid;
            const senderName = msg.pushName || 'Arkadaş';

            let shouldRespond = false;
            let cleanMessage = messageContent;

            if (isGroup) {
                if (lowerContent.includes(TRIGGER_WORD)) {
                    shouldRespond = true;
                    cleanMessage = messageContent.replace(new RegExp(TRIGGER_WORD, 'gi'), '').trim();
                }
                const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botNumber = sock.user?.id?.split(':')[0];
                if (botNumber && mentionedJids.some(jid => jid.includes(botNumber))) {
                    shouldRespond = true;
                    cleanMessage = messageContent.replace(/@\d+/g, '').trim();
                }
            } else {
                shouldRespond = true;
            }

            if (!shouldRespond || !cleanMessage.trim()) continue;

            try {
                await sock.sendPresenceUpdate('composing', chatId);
                const prompt = isGroup ? `[${senderName}]: ${cleanMessage}` : cleanMessage;
                const response = await getGeminiResponse(senderId, prompt);
                await sock.sendMessage(chatId, { text: response }, { quoted: msg });
                console.log(`✉️ ${senderName}: ${cleanMessage.substring(0, 40)}`);
            } catch (err) {
                console.error('Gönderme hatası:', err.message);
            }
        }
    });

    return sock;
}

process.on('uncaughtException', (err) => console.error('Hata:', err.message));
process.on('unhandledRejection', (err) => console.error('Promise hatası:', err?.message));

startBot();
