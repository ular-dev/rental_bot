// bot.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const USERS_FILE = path.join(__dirname, "users.json");

const ADMIN_USERNAME = "@rental_312";
const ADMIN_ID = 545735035;
let globalListingCounter = 1;

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

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");

bot.setMyCommands([
  { command: "/start", description: "Начать подбор квартиры" },
  { command: "/filter", description: "Изменить фильтры" },
]);

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const users = readUsers();

  users[chatId] = users[chatId] || { sentItems: [] };
  users[chatId].id = msg.from.id;
  users[chatId].isStopped = false;
  saveUsers(users);
  sendCitySelection(chatId);
});

bot.onText(/\/filter/, (msg) => {
  const chatId = msg.chat.id;
  const user = readUsers()[chatId];
  if (!user) return bot.sendMessage(chatId, "Сначала используйте /start");

  bot.sendMessage(
    chatId,
    `Ваши фильтры:\n📍 Город: ${user.city || "Не выбран"}\n🏙 Район: ${
      user.district || "Не выбран"
    }\n🛏 Комнаты: ${user.roomFilter || "Не выбрано"}\n\nЧто изменить?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Город", callback_data: "change_city" },
            { text: "Район", callback_data: "change_district" },
          ],
          [{ text: "Комнаты", callback_data: "change_room" }],
          [{ text: "🛑 Стоп", callback_data: "stop_sending" }],
        ],
      },
    }
  );
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const users = readUsers();
  users[chatId] = users[chatId] || { sentItems: [] };

  if (data === "change_city") return sendCitySelection(chatId);
  if (data === "change_room") return sendRoomSelection(chatId);
  if (data === "change_district")
    return sendDistrictSelection(chatId, users[chatId].city);

  if (data.startsWith("city_")) {
    const selectedCity = data.replace("city_", "");
    users[chatId].city = selectedCity;
    users[chatId].cityId =
      cities.find((c) => c.name === selectedCity)?.id || null;
    saveUsers(users);
    return sendDistrictSelection(chatId, selectedCity);
  }

  if (data.startsWith("district_")) {
    const selectedDistrict = data.replace("district_", "");
    const districtData = Object.values(districts)
      .flat()
      .find((d) => d.name === selectedDistrict);
    users[chatId].district = selectedDistrict;
    users[chatId].districtId = districtData?.id || null;
    saveUsers(users);
    return sendRoomSelection(chatId);
  }

  if (data.startsWith("room_")) {
    const selectedRoom = data.replace("room_", "");
    const roomData = roomOptions.find((r) => r.name === selectedRoom);
    users[chatId].roomFilter = selectedRoom;
    users[chatId].roomParam = roomData?.id || null;
    saveUsers(users);
    await bot.sendMessage(
      chatId,
      `✅ Отлично! Вы выбрали: ${selectedRoom}
📬 Мы будем присылать вам актуальные квартиры.
🛑 Чтобы остановить рассылку, нажмите "Стоп" в меню /filter.`
    );
    await bot.answerCallbackQuery(query.id);
  }

  if (data === "stop_sending") {
    users[chatId].isStopped = true;
    saveUsers(users);
    return bot.sendMessage(
      chatId,
      "🚫 Рассылка остановлена. Чтобы снова получать объявления, используйте /start"
    );
  }
});

setInterval(async () => {
  const users = readUsers();
  const chatIds = Object.keys(users);

  for (const chatId of chatIds) {
    const user = users[chatId];
    if (user.isStopped) continue;
    user.sentItems = user.sentItems || [];

    const cityId = user.cityId;
    const districtId = user.districtId;
    const roomParam = user.roomParam;
    if (!cityId || !districtId || !roomParam) continue;

    try {
      const response = await axios.get(
        "https://lalafo.kg/api/search/v3/feed/search",
        {
          headers: { "User-Agent": "Mozilla/5.0", device: "pc" },
          params: {
            expand: "url",
            "per-page": 50,
            category_id: 2044,
            city_id: cityId,
            "parameters[69][0]": roomParam,
            ...(districtId ? { "parameters[357][0]": districtId } : {}),
          },
        }
      );

      const items = response.data.items || [];
      const newItem = items.find(
        (i) => !user.sentItems?.some((si) => si.id === i.id)
      );
      if (!newItem) continue;

      const item = newItem;
      const title =
        item.title?.replace(
          "Long term rental apartments",
          "Сдается квартира"
        ) || "Без названия";
      const importantParams = extractImportantParams(item.params || []);
      const floor =
        importantParams.floorNumber && importantParams.numberOfFloors
          ? `${importantParams.floorNumber} из ${importantParams.numberOfFloors}`
          : "Не указано";
      const whoOwner =
        importantParams.owner?.toLowerCase() === "owner"
          ? "Собственник"
          : "Агентство";
      const deposit = importantParams.deposit || "Не указан";
      const price = item.price
        ? `${item.price} ${item.currency}`
        : "Цена договорная";
      const counter = globalListingCounter++;
      const mobile = item.mobile;

      const caption = `
  <b>${title}</b>
  
  📍 <b>Район:</b> #${user.district}
  💵 <b>Цена:</b> ${price}
  
  🏢 <b>Этаж:</b> ${floor}
  🏠 <b>Комната:</b> ${user.roomFilter}
  🔑 <b>Квартира от:</b> ${whoOwner}
  💰 <b>Депозит:</b> ${deposit}
  
  🆔 <b>Объявление №${counter}</b>
  
  📞 <b>Хочешь номер владельца?</b>
  Напиши админу ${ADMIN_ID === user.id ? mobile : ADMIN_USERNAME}
  Укажи номер объявления: <b>№${counter}</b>
  `.trim();

      const media = (item.images || [])
        .map((img, index) => {
          const imageUrl = img.original_url || img.thumbnail_url;
          if (!imageUrl || !imageUrl.startsWith("http")) return null;

          return {
            type: "photo",
            media: imageUrl,
            caption: index === 0 ? caption : undefined,
            parse_mode: index === 0 ? "HTML" : undefined,
          };
        })
        .filter(Boolean);

      if (media.length > 0) {
        await bot.sendMediaGroup(chatId, media);
      } else {
        await bot.sendMessage(chatId, caption, { parse_mode: "HTML" });
      }

      user.sentItems?.push({
        id: item.id,
        counter,
        mobile,
      });
    } catch (err) {
      if (
        err.response?.data?.description?.includes("USER_IS_BLOCKED") ||
        err.message.includes("USER_IS_BLOCKED")
      ) {
        console.log(`❌ Пользователь ${chatId} заблокировал бота. Удаляю...`);
        delete users[chatId];
      } else {
        console.error("Ошибка отправки сообщения:", err.message);
      }
    }

    // 💤 Пауза между пользователями — 500 мс
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  saveUsers(users);
}, 10 * 60 * 1000);

function extractImportantParams(params) {
  const importantFields = {
    "Floor Number": null,
    "Number of Floors": null,
    "KG - Seller Type": null,
    "Deposit, som": null,
  };

  for (const param of params) {
    if (importantFields.hasOwnProperty(param.name)) {
      importantFields[param.name] = param.value;
    }
  }

  return {
    floorNumber: importantFields["Floor Number"],
    numberOfFloors: importantFields["Number of Floors"],
    owner: importantFields["KG - Seller Type"],
    deposit: importantFields["Deposit, som"],
  };
}

function sendCitySelection(chatId) {
  bot.sendMessage(chatId, "Выберите город:", {
    reply_markup: {
      inline_keyboard: cities.map((city) => [
        { text: city.name, callback_data: `city_${city.name}` },
      ]),
    },
  });
}

function sendDistrictSelection(chatId, city) {
  const list = districts[city] || [];
  const keyboard = [];
  for (let i = 0; i < list.length; i += 2) {
    const row = [];
    row.push({ text: list[i].name, callback_data: `district_${list[i].name}` });
    if (list[i + 1]) {
      row.push({
        text: list[i + 1].name,
        callback_data: `district_${list[i + 1].name}`,
      });
    }
    keyboard.push(row);
  }

  bot.sendMessage(chatId, `Выберите район в городе ${city}:`, {
    reply_markup: { inline_keyboard: keyboard },
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
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// Команда для администратора: /номер 12
bot.onText(/\/номер (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;

  const requestedCounter = parseInt(match[1], 10);
  const users = readUsers();

  for (const chatId in users) {
    const item = (users[chatId].sentItems || []).find(
      (i) => i.counter === requestedCounter
    );
    if (item) {
      return bot.sendMessage(msg.chat.id, `📞 Номер владельца: ${item.mobile}`);
    }
  }

  bot.sendMessage(msg.chat.id, "❌ Объявление не найдено.");
});
