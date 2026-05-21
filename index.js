const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_NAME = process.env.BOT_NAME || 'Asistan';
const TRIGGER_WORD = (process.env.TRIGGER_WORD || '@asistan').toLowerCase();

if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY eksik! Railway Variables kısmına ekle.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const chatHistories = {};

const SYSTEM_PROMPT = `Sen "${BOT_NAME}" adında eğlenceli, zeki ve biraz ukala bir WhatsApp grup botusun. 
Türkçe konuşuyorsun. Gruba dahil olmuş bir arkadaş gibi davranıyorsun.
Kısa ve eğlenceli cevaplar veriyorsun, çok uzun yazılar yazmıyorsun.
Bazen emoji kullanıyorsun ama abartmıyorsun.`;

async function getGeminiResponse(userId, userMessage) {
    try {
        if (!chatHistories[userId]) chatHistories[userId] = [];
        if (chatHistories[userId].length > 40) {
            chatHistories[userId] = chatHistories[userId].slice(-20);
        }

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
        console.error('Gemini hatası:', error);
        return '😵 Bir hata oluştu, birazdan tekrar dene!';
    }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n\n📱 WHATSAPP QR KODUNU TARA:\n');
            qrcode.generate(qr, { small: true });
            console.log('\nWhatsApp > 3 Nokta > Bağlı Cihazlar > Cihaz Ekle\n');
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            console.log('Bağlantı kesildi, kod:', code, 'Yeniden bağlanıyor:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            } else {
                console.log('❌ Oturum kapandı. auth_info klasörünü sil ve yeniden başlat.');
            }
        } else if (connection === 'open') {
            console.log(`\n✅ ${BOT_NAME} bağlandı ve hazır! Grubu bekliyor...\n`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            if (!msg.message) continue;

            const chatId = msg.key.remoteJid;
            const isGroup = chatId.endsWith('@g.us');

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
                if (mentionedJids.some(jid => jid.includes(botNumber))) {
                    shouldRespond = true;
                    cleanMessage = messageContent.replace(/@\d+/g, '').trim();
                }
            } else {
                shouldRespond = true;
            }

            if (!shouldRespond || !cleanMessage) continue;

            try {
                await sock.sendPresenceUpdate('composing', chatId);
                const prompt = isGroup ? `[${senderName} yazdı]: ${cleanMessage}` : cleanMessage;
                const response = await getGeminiResponse(senderId, prompt);

                await sock.sendMessage(chatId, { text: response }, { quoted: msg });
                console.log(`✉️ [${senderName}]: ${cleanMessage.substring(0, 50)}`);
            } catch (error) {
                console.error('Mesaj gönderme hatası:', error);
            }
        }
    });
}

startBot().catch(console.error);
