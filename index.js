const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// === AYARLAR ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_NAME = process.env.BOT_NAME || 'Asistan';
const TRIGGER_WORD = (process.env.TRIGGER_WORD || '@asistan').toLowerCase();

// === GEMİNİ KURULUM ===
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Sohbet geçmişi (kişi başına)
const chatHistories = {};

// Sistem prompt - botun kişiliği
const SYSTEM_PROMPT = `Sen "${BOT_NAME}" adında eğlenceli, zeki ve biraz ukala bir WhatsApp grup botusun. 
Türkçe konuşuyorsun. Gruba dahil olmuş bir arkadaş gibi davranıyorsun.
Kısa ve eğlenceli cevaplar veriyorsun, çok uzun yazılar yazmıyorsun.
Bazen emoji kullanıyorsun ama abartmıyorsun.
Grubun havasına göre şakacı olabilirsin.
Kişilik analizi istenirse eğlenceli ve yaratıcı analizler yapıyorsun.`;

async function getGeminiResponse(userId, userMessage) {
    try {
        if (!chatHistories[userId]) {
            chatHistories[userId] = [];
        }

        // Geçmiş çok uzarsa temizle (son 20 mesaj)
        if (chatHistories[userId].length > 40) {
            chatHistories[userId] = chatHistories[userId].slice(-20);
        }

        const chat = model.startChat({
            history: chatHistories[userId],
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.9,
            },
            systemInstruction: SYSTEM_PROMPT,
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response.text();

        // Geçmişe ekle
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
        printQRInTerminal: true,
        browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 QR kodu tara! WhatsApp > Bağlı Cihazlar > Cihaz Ekle\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Bağlantı kesildi. Yeniden bağlanıyor:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} bağlandı ve hazır!`);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue; // Kendi mesajlarını atla
            if (!msg.message) continue;

            const chatId = msg.key.remoteJid;
            const isGroup = chatId.endsWith('@g.us');

            // Mesaj içeriğini al
            const messageContent = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption || '';

            if (!messageContent) continue;

            const lowerContent = messageContent.toLowerCase();
            const senderId = msg.key.participant || msg.key.remoteJid;
            const senderName = msg.pushName || 'Arkadaş';

            let shouldRespond = false;
            let cleanMessage = messageContent;

            if (isGroup) {
                // Grupta: trigger kelimesi veya @mention ile tetikle
                if (lowerContent.includes(TRIGGER_WORD)) {
                    shouldRespond = true;
                    cleanMessage = messageContent.replace(new RegExp(TRIGGER_WORD, 'gi'), '').trim();
                }

                // Botun numarasına mention edilince
                const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botJid = sock.user?.id;
                if (mentionedJids.some(jid => jid === botJid || botJid?.includes(jid))) {
                    shouldRespond = true;
                    cleanMessage = messageContent.replace(/@\d+/g, '').trim();
                }
            } else {
                // Özel mesajda: her zaman cevap ver
                shouldRespond = true;
            }

            if (!shouldRespond || !cleanMessage) continue;

            try {
                // "yazıyor..." göster
                await sock.sendPresenceUpdate('composing', chatId);

                const prompt = isGroup
                    ? `[Grup mesajı, gönderen: ${senderName}] ${cleanMessage}`
                    : cleanMessage;

                const response = await getGeminiResponse(senderId, prompt);

                // Cevap gönder
                await sock.sendMessage(chatId, {
                    text: response,
                    mentions: [senderId]
                }, { quoted: msg });

                console.log(`✉️ ${senderName}: ${cleanMessage.substring(0, 50)}...`);
            } catch (error) {
                console.error('Mesaj gönderme hatası:', error);
            }
        }
    });
}

startBot().catch(console.error);
