require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const Bottleneck = require("bottleneck");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const USERS_FILE = path.join(__dirname, "users.json");

const ADMIN_ID = 8185930364;
const MAX_ITEMS_PER_HOUR = 10;
const MAX_FREE_ITEMS = 4;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 40 });
const safeSendMessage = limiter.wrap(bot.sendMessage.bind(bot));
const safeSendPhoto = limiter.wrap(bot.sendPhoto.bind(bot));
const safeSendMediaGroup = limiter.wrap(bot.sendMediaGroup.bind(bot));
const safeAnswerCallback = limiter.wrap(bot.answerCallbackQuery.bind(bot));

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}", "utf8");

const cities = [
  { name: "Бишкек", id: 103184 },
  { name: "Ош", id: 103218 },
  { name: "Иссык-Куль", id: null },
];

const districts = {
  Бишкек: [
    { name: "Все районы", id: null },
    { name: "ЦУМ", id: [5015, 45272, 56389, 27187, 30388] },
    {
      name: "Бишкек Парк ТРЦ",
      id: [30256, 45267, 30265, 30274, 45274, 51199, 45281],
    },
    { name: "Золотой квадрат", id: [45284, 30278, 45269] },
    { name: "1000 мелочей", id: [30228, 56402] },
    { name: "Асанбай", id: [23249, 56387, 56415] },
    {
      name: "Микрорайоны",
      id: [
        23202, 30231, 30236, 30232, 30233, 30229, 30234, 30235, 30237, 30238,
      ],
    },
    { name: "Мед академия", id: [30250, 27224] },
    { name: "Вефа", id: [56388, 27204, 27210] },
    { name: "Политех", id: [5014, 30241] },
    { name: "Тунгуч", id: [23206, 23222, 23225] },
    { name: "Аламедин-1", id: [23245, 30373] },
    { name: "Орто-Сай", id: 23202 },
    { name: "Аламедин рынок", id: [23211, 30350, 27186] },
    { name: "Кызыл-Аскер", id: 23235 },
    { name: "Арча-Бешик", id: 23207 },
    { name: "Джал мкр", id: 23217 },
    { name: "Моссовет", id: 27222 },
    { name: "Ала арча ТРЦ", id: [30392, 56415] },
    { name: "Восток-5", id: [23200, 27206] },
    { name: "Азия молл", id: [30239, 23205] },
    { name: "Кок жар мкр", id: [23228, 30257, 45279, 27199] },
    { name: "Ош рынок", id: [45275, 23212, 23218, 45281] },
    { name: "Рабочий Городок", id: [23219, 23218] },
    { name: "Филармония", id: 23214 },
  ],
  Ош: [
    { name: "Все районы", id: null },
    { name: "Амир-Темур", id: 6001 },
    { name: "Курманжан-Датка", id: 6002 },
    { name: "Черёмушки", id: 6003 },
    { name: "ВОЕНГОРОДОК", id: 6004 },
  ],
  'Иссык-Куль': [
    { name: "Все районы", id: null },
    { name: "Радуга", id: 30589 },
    { name: "Золотые пески", id: 30598 },
    { name: "Chaika Resort", id: 38837 },
    { name: "Карвен 4 сезона", id: 30588 },
    { name: "Palm Beach", id: 30605 },
    { name: "Кыргызское взморье", id: 30590 },
    { name: "Радуга West", id: 30603 },
    { name: "Каприз", id: 30594 },
    { name: "Лазурный берег", id: 30593 },
    { name: "Asia Palace", id: 38835 },
  ],
};

const roomOptions = [
  { name: "Студия", id: 15496 },
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
    freeViewed: 0,
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
      `⏳ Вы уже просмотрели ${MAX_ITEMS_PER_HOUR} объявлений за последний час.\n\n🔁 Попробуйте снова через час — тогда появятся новые предложения.`
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
  • 3 дня — 400 сом
  • 5 дня — 600 сом
  
  💰 <b>Оплата:</b> 0504 399 696 (Единица)
  
  📩 После оплаты — напишите @rental_kg  
  🔑 Укажите ваш Telegram ID: <code>${chatId}</code>`,
      { parse_mode: "HTML" }
    );
  }

  if (query.data === "show_5") {
    if (!user.city || !user.district) {
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
      let params;

      if (user.city?.name === "Иссык-Куль") {
        // Запрос для пансионатов
        params = {
          expand: "url",
          "per-page": 100,
          category_id: 3199, // Пансионаты
          "parameters[925][0]": user.district.id, // Пансионаты
        };
      } else {
        // Запрос для квартир
        params = {
          expand: "url",
          "per-page": 100,
          category_id: 2044,
          city_id: user.city.id,
          "parameters[69][0]": user.room.id, // Комнаты
          // "parameters[2149][0]": 19057, // Тип недвижимости
        };

        if (Array.isArray(user.district.id)) {
          user.district.id.forEach((id, i) => {
            params[`parameters[357][${i}]`] = id;
          });
        } else {
          params["parameters[357][0]"] = user.district.id;
        }
      }

      const response = await axios.get(
        "https://lalafo.kg/api/search/v3/feed/search",
        {
          headers: { "User-Agent": "Mozilla/5.0", device: "pc" },
          params,
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
          "📭 Новых квартир пока нет. Попробуйте позже.",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🔁 Изменить фильтр",
                    callback_data: "change_filters",
                  },
                ],
              ],
            },
          }
        );
      }
      for (const item of newItems) {
        const counter = user.sentItems.length + 1;
        const hasSubscription =
          user.hasSubscriptionUntil && Date.now() < user.hasSubscriptionUntil;
        const isFreeAvailable = user.freeViewed < MAX_FREE_ITEMS;
        // ❗ Если нет подписки и бесплатный лимит исчерпан — пропускаем
        if (!hasSubscription && !isFreeAvailable) {
          continue;
        }
        console.log(item, 'item');
        const isIssykKul = user.city?.name === "Иссык-Куль";

const caption = `
🏠 <b>${item.title || "Объявление"}</b>

💵 <b>Цена:</b> ${item.price || "Договорная"} ${item.symbol || ""}
📍 <b>Район:</b> ${user.district?.name}
${!isIssykKul ? `🛏 <b>Комнат:</b> ${user.room?.name}` : ""}
📞 <b>Номер:</b> ${
  hasSubscription || isFreeAvailable
    ? item.mobile
    : "🔒 Доступен по подписке"
}
${isIssykKul ? `\n📝 <b>Описание:</b> ${item.description || "—"}` : ""}
`;
;

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
            await safeSendMediaGroup(chatId, media);
          } else {
            await safeSendMessage(chatId, caption, {
              parse_mode: "HTML",
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
        if (!hasSubscription && isFreeAvailable) {
          user.freeViewed += 1;
        }
      }

      saveUsers(users);
      const hasSubscription =
        user.hasSubscriptionUntil && Date.now() < user.hasSubscriptionUntil;
      const isFreeAvailable = user.freeViewed < MAX_FREE_ITEMS;

      if (hasSubscription || isFreeAvailable) {
        await safeSendMessage(chatId, "Хотите увидеть ещё?", {
          reply_markup: {
            inline_keyboard: [
              ...(hasSubscription || isFreeAvailable
                ? [
                    [
                      {
                        text: "Показать ещё 2 квартиры",
                        callback_data: "show_5",
                      },
                    ],
                  ]
                : []),
              [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
            ],
          },
        });
      } else {
        await safeSendMessage(
          chatId,
          `🎁 Вы использовали все бесплатные просмотры.
      
      Чтобы продолжить — оформите подписку:`,
          {
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
  
    if (user.city.name === "Иссык-Куль") {
      // Сразу показываем кнопку показа, минуя выбор комнат
      const now = Date.now();
      const hasSubscription = user.hasSubscriptionUntil && user.hasSubscriptionUntil > now;
      const isFreeAvailable = user.freeViewed < MAX_FREE_ITEMS;
  
      if (hasSubscription || isFreeAvailable) {
        await safeSendMessage(chatId, "✅ Фильтр сохранён.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Показать 2 пансионата", callback_data: "show_5" }],
              [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
            ],
          },
        });
      } else {
        await safeSendMessage(
          chatId,
          `✅ Фильтр сохранён.\n\n🎁 Вы использовали все бесплатные просмотры.\nЧтобы продолжить — оформите подписку:`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 Оформить подписку", callback_data: "buy_subscription" }],
                [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
              ],
            },
          }
        );
      }
    } else {
      return sendRoomSelection(chatId);
    }
  }  

  if (query.data.startsWith("room_")) {
    const roomName = query.data.replace("room_", "");
    const room = roomOptions.find((r) => r.name === roomName);
    user.room = room;
    saveUsers(users);

    const now = Date.now();
    const hasSubscription =
      user.hasSubscriptionUntil && user.hasSubscriptionUntil > now;
    const isFreeAvailable = user.freeViewed < MAX_FREE_ITEMS;

    if (hasSubscription || isFreeAvailable) {
      await safeSendMessage(chatId, "✅ Фильтр сохранён.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Показать 2 квартиры", callback_data: "show_5" }],
            [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
          ],
        },
      });
    } else {
      await safeSendMessage(
        chatId,
        `✅ Фильтр сохранён.\n\n🎁 Вы использовали все бесплатные просмотры.\nЧтобы продолжить — оформите подписку:`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "💳 Оформить подписку",
                  callback_data: "buy_subscription",
                },
              ],
              [{ text: "🔄 Изменить фильтр", callback_data: "change_filter" }],
            ],
          },
        }
      );
    }
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
  const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  for (const user of Object.values(data)) {
    if (user.freeViewed === undefined) user.freeViewed = 0;
  }
  return data;
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

bot.onText(/\/sub (\d+) (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const userId = parseInt(match[1], 10);
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
        await safeSendMessage(
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
        await safeSendMessage(
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

bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;

  const users = readUsers();
  const total = Object.keys(users).length;

  let withSub = 0;
  const now = Date.now();

  for (const u of Object.values(users)) {
    if (u.hasSubscriptionUntil && u.hasSubscriptionUntil > now) {
      withSub++;
    }
  }

  bot.sendMessage(
    msg.chat.id,
    `📊 Всего пользователей: <b>${total}</b>\n🟢 С активной подпиской: <b>${withSub}</b>`,
    { parse_mode: "HTML" }
  );
});
