// rental_bot_v2.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const USERS_FILE = path.join(__dirname, "users.json");

const ADMIN_ID = 8185930364;
const MAX_ITEMS_PER_HOUR = 12;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}", "utf8");

const cities = [
  { name: "Бишкек", id: 103184 },
  { name: "Ош", id: 103218 },
];

const districts = {
  Бишкек: [
    { name: "Все районы", id: null },
    { name: "Асанбай", id: 23249 },
    { name: "Ата-Тюрк парк", id: 30250 },
    { name: "Бишкек Парк ТРЦ", id: 30256 },
    { name: "Джал мкр", id: 23217 },
    { name: "Юг-2", id: 27210 },
    { name: "Восток-5", id: 23200 },
    { name: "Тунгуч", id: 23206 },
    { name: "Моссовет", id: 27222 },
    { name: "Аламедин-1", id: 23245 },
    { name: "Аламединский рынок", id: 23211 },
    { name: "12 мкр", id: 30231 },
    { name: "7 мкр", id: 30236 },
    { name: "Орто-Сай", id: 23202 },
    { name: "Кызыл-Аскер", id: 23235 },
    { name: "Учкун", id: 23225 },
    { name: "Политех", id: 5014 },
    { name: "ЦУМ", id: 5015 },
  ],
  Ош: [
    { name: "Все районы", id: null },
    { name: "Амир-Темур", id: 6001 },
    { name: "Курманжан-Датка", id: 6002 },
    { name: "Черёмушки", id: 6003 },
    { name: "ВОЕНГОРОДОК", id: 6004 },
  ],
};

const roomOptions = [
  { name: "1 комната", id: 2773 },
  { name: "2 комнаты", id: 2774 },
  { name: "3 комнаты", id: 2775 },
  { name: "4 комнаты", id: 2776 },
];

bot.setMyCommands([
  { command: "/start", description: "🔄 Запустить бота" },
  { command: "/subinfo", description: "🔐 Моя подписка и ID" },
]);

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const users = readUsers();

  users[chatId] = users[chatId] || {
    id: msg.from.id,
    city: null,
    district: null,
    room: null,
    sentItems: [],
  };

  const user = users[chatId];
  const now = Date.now();
  user.sentItems = user.sentItems.filter(
    (item) => now - item.sentAt < TWO_DAYS_MS
  );
  const sentThisHour = user.sentItems.filter(
    (item) => now - item.sentAt < 60 * 60 * 1000
  );

  saveUsers(users);

  if (sentThisHour.length >= MAX_ITEMS_PER_HOUR) {
    return bot.sendMessage(
      chatId,
      `⏳ Вы уже посмотрели ${MAX_ITEMS_PER_HOUR} квартир за последний час. Попробуйте позже.`
    );
  }

  sendCitySelection(chatId);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const users = readUsers();
  users[chatId] = users[chatId] || {
    id: query.from.id,
    city: null,
    district: null,
    room: null,
    sentItems: [],
  };
  const user = users[chatId];

  if (query.data === "change_filter") {
    user.city = null;
    user.district = null;
    user.room = null;
    saveUsers(users);
    bot.answerCallbackQuery(query.id);
    return sendCitySelection(chatId);
  }

  if (query.data === "buy_subscription") {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
      `📅 <b>Тарифы подписки:</b>
  • 1 день — 200 сом
  • 3 дня — 500 сом
  
  💰 <b>Оплата:</b> 0504 399 696 (Единица)
  
  📩 После оплаты — напишите @rental_kg для активации подписки.`,
      { parse_mode: "HTML" }
    );
  }

  if (query.data === "show_5") {
    if (!user.city || !user.room || !user.district) {
      return bot.sendMessage(
        chatId,
        "❗ Пожалуйста, выберите все фильтры: город, район и количество комнат."
      );
    }
    bot.answerCallbackQuery(query.id);
    const now = Date.now();
    user.sentItems = user.sentItems.filter(
      (item) => now - item.sentAt < TWO_DAYS_MS
    );

    const sentThisHour = user.sentItems.filter(
      (item) => now - item.sentAt < 60 * 60 * 1000
    );

    if (sentThisHour.length >= MAX_ITEMS_PER_HOUR) {
      user.limitReachedAt = now;
      saveUsers(users);
      return bot.sendMessage(
        chatId,
        `⏳ Вы уже посмотрели ${MAX_ITEMS_PER_HOUR} квартир за последний час. Попробуйте позже.`
      );
    }

    try {
      const response = await axios.get(
        "https://lalafo.kg/api/search/v3/feed/search",
        {
          headers: { "User-Agent": "Mozilla/5.0", device: "pc" },
          params: {
            expand: "url",
            "per-page": 100,
            category_id: 2044,
            city_id: user.city.id,
            "parameters[69][0]": user.room.id,
            "parameters[357][0]": user.district.id,
            "parameters[2149][0]": 19057,
          },
        }
      );

      const availableItems = response.data.items || [];

      const newItems = availableItems
        .filter(
          (item) =>
            !user.sentItems.some((si) => si.id === item.id) && item.mobile
        )
        .slice(0, 2);

      if (!newItems.length) {
        return bot.sendMessage(
          chatId,
          "📭 Новых квартир пока нет. Попробуйте позже."
        );
      }
      for (const item of newItems) {
        const counter = user.sentItems.length + 1;
        const hasSubscription =
          user.hasSubscriptionUntil && Date.now() < user.hasSubscriptionUntil;
        const caption = `
🏠 <b>${item.title || "Объявление"}</b>

💵 Цена: ${item.price || "-"} ${item.symbol || ""}
📍 Район: ${user.district.name}
🛏 Комнаты: ${user.room.name}
   Номер: ${hasSubscription ? item.mobile : "Оформите подписку"}
`;

        const buttons = hasSubscription
          ? undefined
          : {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "💳 Оформить подписку",
                      callback_data: "buy_subscription",
                    },
                  ],
                ],
              },
            };

        const media = (item.images || [])
          .filter(
            (img) => img.original_url && img.original_url.startsWith("http")
          )
          .slice(0, 5)
          .map((img, idx) => ({
            type: "photo",
            media: img.original_url,
            caption: idx === 0 ? caption : undefined,
            parse_mode: idx === 0 ? "HTML" : undefined,
          }));

        try {
          if (media.length) {
            await bot.sendMediaGroup(chatId, media);
            if (!hasSubscription) {
              await bot.sendMessage(
                chatId,
                `🔒 <b>Номер скрыт</b>\nЧтобы получить доступ к номерам владельцев — оформите подписку.\n\n✍️ Напишите: @rental_kg`,
                {
                  parse_mode: "HTML",
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "💳 Оформить подписку",
                          callback_data: "buy_subscription",
                        },
                      ],
                    ],
                  },
                }
              );
            }
          } else {
            await bot.sendMessage(chatId, caption, {
              parse_mode: "HTML",
              ...buttons,
            });
          }
          await new Promise((r) => setTimeout(r, 2000));
        } catch (err) {
          if (
            err.response?.statusCode === 403 ||
            err.message.includes("bot was blocked")
          ) {
            console.log(
              `❌ Пользователь ${chatId} заблокировал бота. Удаляю...`
            );
            delete users[chatId];
            saveUsers(users);
            return;
          } else {
            console.error("Ошибка отправки:", err.message);
          }
        }

        const alreadySent = user.sentItems.some((i) => i.id === item.id);
        if (!alreadySent) {
          user.sentItems.push({
            id: item.id,
            counter,
            mobile: item.mobile,
            sentAt: now,
          });
        }
      }

      saveUsers(users);
      if (
        user.sentItems.filter((item) => now - item.sentAt < 60 * 60 * 1000)
          .length < MAX_ITEMS_PER_HOUR
      ) {
        bot.sendMessage(chatId, "Хотите увидеть ещё?", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Показать ещё 2 квартиры", callback_data: "show_5" }],
              [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
            ],
          },
        });
      } else {
        user.limitReachedAt = now;
        saveUsers(users);
        bot.sendMessage(
          chatId,
          `⏳ Вы уже посмотрели ${MAX_ITEMS_PER_HOUR} квартир 🏠 за этот час.

          🔔 Новые варианты появятся через час — обязательно загляните!`
        );
      }
    } catch (e) {
      console.error("Ошибка загрузки квартир:", e.message);
      bot.sendMessage(chatId, "Произошла ошибка. Попробуйте позже.");
    }
    return;
  }

  if (query.data.startsWith("city_")) {
    const cityName = query.data.replace("city_", "");
    const city = cities.find((c) => c.name === cityName);
    user.city = city;
    user.district = null;
    saveUsers(users);
    return sendDistrictSelection(chatId, cityName);
  }

  if (query.data.startsWith("district_")) {
    const districtName = query.data.replace("district_", "");
    const district = Object.values(districts)
      .flat()
      .find((d) => d.name === districtName);
    user.district = district;
    saveUsers(users);
    return sendRoomSelection(chatId);
  }

  if (query.data.startsWith("room_")) {
    const roomName = query.data.replace("room_", "");
    const room = roomOptions.find((r) => r.name === roomName);
    user.room = room;
    saveUsers(users);
    bot.sendMessage(chatId, "✅ Фильтр сохранён.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Показать 2 квартиры", callback_data: "show_5" }],
          [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
        ],
      },
    });
  }
});

function sendCitySelection(chatId) {
  bot.sendMessage(chatId, "Выберите город:", {
    reply_markup: {
      inline_keyboard: cities.map((city) => [
        { text: city.name, callback_data: `city_${city.name}` },
      ]),
    },
  });
}

function sendDistrictSelection(chatId, cityName) {
  const rows = [];
  const list = districts[cityName] || [];
  for (let i = 0; i < list.length; i += 2) {
    const row = [
      { text: list[i].name, callback_data: `district_${list[i].name}` },
    ];
    if (list[i + 1]) {
      row.push({
        text: list[i + 1].name,
        callback_data: `district_${list[i + 1].name}`,
      });
    }
    rows.push(row);
  }
  bot.sendMessage(chatId, "Выберите район:", {
    reply_markup: { inline_keyboard: rows },
  });
}

function sendRoomSelection(chatId) {
  bot.sendMessage(chatId, "Выберите количество комнат:", {
    reply_markup: {
      inline_keyboard: roomOptions.map((room) => [
        { text: room.name, callback_data: `room_${room.name}` },
      ]),
    },
  });
}

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

bot.onText(/\/sub (\d+) (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const userId = match[1];
  const days = parseInt(match[2], 10);
  const users = readUsers();

  if (!users[userId]) {
    return bot.sendMessage(msg.chat.id, "❗ Пользователь не найден.");
  }

  const now = Date.now();
  const currentExpiry = users[userId].hasSubscriptionUntil || 0;
  const baseTime = currentExpiry > now ? currentExpiry : now;

  users[userId].hasSubscriptionUntil = baseTime + days * 24 * 60 * 60 * 1000;
  users[userId].sentItems = [];

  delete users[userId].limitReachedAt;

  saveUsers(users);

  const untilDate = new Date(users[userId].hasSubscriptionUntil).toLocaleString(
    "ru-RU",
    { timeZone: "Asia/Bishkek" }
  );
  bot.sendMessage(
    msg.chat.id,
    `✅ Подписка активна до ${untilDate} для пользователя ${userId}`
  );

  const subText =
    `🎉 Ваша подписка активирована!\n` +
    `📅 Действует до: <b>${untilDate}</b>\n\n` +
    `Теперь вы получаете доступ ко всем объявлениям с номерами владельцев.`;

  bot.sendMessage(userId, subText, { parse_mode: "HTML" });

  if (users[userId].city && users[userId].district && users[userId].room) {
    bot.sendMessage(userId, "📢 Подписка активна. Показать новые квартиры?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Показать 2 квартиры", callback_data: "show_5" }],
          [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
        ],
      },
    });
  } else {
    bot
      .sendMessage(
        userId,
        "📌 Подписка активирована. Для начала выберите фильтры: город, район и количество комнат."
      )
      .then(() => {
        sendCitySelection(userId);
      });
  }
});

bot.onText(/\/subinfo/, (msg) => {
  const users = readUsers();
  const user = users[msg.chat.id];

  if (!user) {
    return bot.sendMessage(msg.chat.id, "Вы ещё не использовали бота.");
  }

  const now = Date.now();
  const hasSub = user.hasSubscriptionUntil && user.hasSubscriptionUntil > now;
  const untilDate = hasSub
    ? new Date(user.hasSubscriptionUntil).toLocaleString("ru-RU", {
        timeZone: "Asia/Bishkek",
      })
    : "-";

  bot.sendMessage(
    msg.chat.id,
    `📱 <b>Статус подписки:</b> ${hasSub ? "активна ✅" : "неактивна ❌"}\n` +
      `⏰ <b>Действует до:</b> ${untilDate}\n` +
      `🆔 <b>Ваш ID:</b> <code>${msg.chat.id}</code>`,
    { parse_mode: "HTML" }
  );
});

// Проверка каждые 10 минут
setInterval(() => {
  const users = readUsers();
  const now = Date.now();

  Object.entries(users).forEach(async ([chatId, user]) => {
    // Удаляем истекшую подписку и уведомляем
    if (user.hasSubscriptionUntil && user.hasSubscriptionUntil < now) {
      delete user.hasSubscriptionUntil;
      saveUsers(users);
      try {
        await bot.sendMessage(
          chatId,
          "⏳ Ваша подписка закончилась. Чтобы снова получать объявления с номерами — оформите подписку."
        );
      } catch (err) {
        console.error(
          `Ошибка при уведомлении о подписке ${chatId}:`,
          err.message
        );
      }
    }

    if (user.limitReachedAt && now - user.limitReachedAt >= 60 * 60 * 1000) {
      delete user.limitReachedAt;
      saveUsers(users);
      try {
        await bot.sendMessage(
          chatId,
          "✅ Прошел час — вы снова можете смотреть квартиры. Нажмите кнопку ниже 👇",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Показать 2 квартиры", callback_data: "show_5" }],
              ],
            },
          }
        );
      } catch (err) {
        console.error(`Ошибка отправки напоминания ${chatId}:`, err.message);
      }
    }
  });
}, 10 * 60 * 1000); // каждые 10 минут
