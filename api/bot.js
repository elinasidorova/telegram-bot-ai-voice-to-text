const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const FormData = require('form-data');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('Привет! Я бот для расшифровки лекций. Просто отправь мне аудио, видео или голосовое сообщение.'));

bot.on(['audio', 'video', 'voice', 'video_note', 'document'], async (ctx) => {
  try {
    let fileId;
    
    if (ctx.message.audio) {
      fileId = ctx.message.audio.file_id;
      await ctx.reply('Получил аудио, обрабатываю...');
    } else if (ctx.message.voice) {
      fileId = ctx.message.voice.file_id;
      await ctx.reply('Получил голосовое, обрабатываю...');
    } else if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      await ctx.reply('Получил видео, обрабатываю...');
    } else if (ctx.message.video_note) {
      fileId = ctx.message.video_note.file_id;
      await ctx.reply('Получил видео-кружок, обрабатываю...');
    } else if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
      await ctx.reply('Получил документ, обрабатываю...');
    } else {
      return;
    }

    // Получаем ссылку на файл из Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);
    
    // Скачиваем файл
    const fileResponse = await fetch(fileLink);
    const buffer = await fileResponse.buffer();

    // Отправляем в OpenAI API через ProxyAPI
    const form = new FormData();
    form.append('file', buffer, 'audio.ogg');
    form.append('model', 'whisper-1');

    const apiUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    
    const openaiResponse = await fetch(`${apiUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form
    });

    const data = await openaiResponse.json();

    if (data.text) {
      await ctx.reply(`Вот расшифровка:\n\n${data.text}`);
    } else {
      await ctx.reply('Не удалось распознать. Проверьте качество записи.');
    }

  } catch (error) {
    console.error('Ошибка:', error);
    await ctx.reply('Произошла ошибка при обработке. Попробуйте еще раз.');
  }
});

bot.on('text', (ctx) => {
  ctx.reply('Пожалуйста, отправьте аудио, видео или голосовое сообщение для расшифровки.');
});

// Запускаем бота
bot.launch().then(() => {
  console.log('Бот успешно запущен!');
});

// Включаем graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
