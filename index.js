const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_NAME = process.env.BOT_NAME || 'Asistan';
const TRIGGER_WORD = (process.env.TRIGGER_WORD || '@asistan').toLowerCase();

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
const chatHistories = {};

async function getResponse(userId, message) {
    if (!chatHistories[userId]) chatHistories[userId] = [];
    if (chatHistories[userId].length > 40) chatHistories[userId] = chatHistories[userId].slice(-20);
    const chat = model.startChat({
        history: chatHistories[userId],
        generationConfig: { maxOutputTokens: 500, temperature: 0.9 },
        systemInstruction: `Sen ${BOT_NAME} adında eğlenceli bir WhatsApp botusun. Türkçe konuş, kısa cevap ver.`
    });
    const result = await chat.sendMessage(message);
    const response = result.response.text();
    chatHistories[userId].push(
        { role: 'user', parts: [{ text: message }] },
        { role: 'model', parts: [{ text: response }] }
    );
    return response;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true
    }
});

client.on('qr', (qr) => {
    console.log('\n====== QR KODU TARA ======\n');
    qrcode.generate(qr, { small: true });
    console.log('\nWhatsApp > Bağlı Cihazlar > Cihaz Ekle\n');
});

client.on('ready', () => console.log(`✅ ${BOT_NAME} hazır!`));

client.on('message', async (msg) => {
    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const body = msg.body.toLowerCase();
    const senderId = msg.from;
    const senderName = msg._data?.notifyName || 'Arkadaş';

    let shouldRespond = false;
    let cleanMessage = msg.body;

    if (isGroup) {
        if (body.includes(TRIGGER_WORD)) {
            shouldRespond = true;
            cleanMessage = msg.body.replace(new RegExp(TRIGGER_WORD, 'gi'), '').trim();
        }
        if (msg.mentionedIds?.includes(client.info.wid._serialized)) {
            shouldRespond = true;
            cleanMessage = msg.body.replace(/@\d+/g, '').trim();
        }
    } else {
        shouldRespond = true;
    }

    if (!shouldRespond || !cleanMessage.trim()) return;

    try {
        const prompt = isGroup ? `[${senderName}]: ${cleanMessage}` : cleanMessage;
        const response = await getResponse(senderId, prompt);
        msg.reply(response);
        console.log(`✉️ ${senderName}: ${cleanMessage.substring(0, 40)}`);
    } catch (err) {
        console.error('Hata:', err.message);
    }
});

client.initialize();
