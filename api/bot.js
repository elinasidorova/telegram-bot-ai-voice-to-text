const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Вспомогательная функция для нарезки аудио на куски по ~10 минут
async function splitAudio(buffer) {
  const chunks = [];
  const CHUNK_DURATION = 600; // 10 минут в секундах

  return new Promise((resolve, reject) => {
    // Создаем поток из буфера
    const bufferStream = new Readable();
    bufferStream.push(buffer);
    bufferStream.push(null);

    ffmpeg(bufferStream)
      .format('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .outputOptions([
        `-f segment`,
        `-segment_time ${CHUNK_DURATION}`,
        '-reset_timestamps 1'
      ])
      .on('end', () => resolve(chunks))
      .on('error', reject)
      .pipe({
        write: (chunk) => chunks.push(chunk),
        end: () => {},
        on: () => {},
        emit: () => {},
      });
  });
}

bot.start((ctx) => ctx.reply('Привет! Я бот для расшифровки лекций. Просто отправь мне аудио, видео или голосовое сообщение.'));

bot.on(['audio', 'video', 'voice', 'video_note', 'document'], async (ctx) => {
  try {
    let fileId;
    
    if (ctx.message.audio) {
      fileId = ctx.message.audio.file_id;
      await ctx.reply('🎧 Получил аудио, обрабатываю...');
    } else if (ctx.message.voice) {
      fileId = ctx.message.voice.file_id;
      await ctx.reply('🎤 Получил голосовое, обрабатываю...');
    } else if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      await ctx.reply('🎬 Получил видео, обрабатываю...');
    } else if (ctx.message.video_note) {
      fileId = ctx.message.video_note.file_id;
      await ctx.reply('🎥 Получил видео-кружок, обрабатываю...');
    } else if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
      await ctx.reply('📁 Получил документ, обрабатываю...');
    } else {
      return;
    }

    // Получаем файл из Telegram
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const fileResponse = await fetch(fileLink);
    const buffer = await fileResponse.buffer();

    const FILE_SIZE_LIMIT = 25 * 1024 * 1024; // 25 МБ

    let fullTranscript = '';

    if (buffer.length <= FILE_SIZE_LIMIT) {
      // Файл меньше 25 МБ — обрабатываем как обычно
      const form = new FormData();
      form.append('file', buffer, 'audio.mp3');
      form.append('model', 'whisper-1');

      const apiUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const openaiResponse = await fetch(`${apiUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form
      });

      const data = await openaiResponse.json();
      if (data.text) {
        fullTranscript = data.text;
      } else {
        await ctx.reply('Не удалось распознать. Проверьте качество записи.');
        return;
      }
    } else {
      // Файл больше 25 МБ — режем на куски
      await ctx.reply('📦 Файл больше 25 МБ, разрезаю на куски для обработки... Это может занять несколько минут.');
      
      const audioChunks = await splitAudio(buffer);
      const transcripts = [];
      
      for (let i = 0; i < audioChunks.length; i++) {
        await ctx.reply(`🔄 Обрабатываю часть ${i + 1} из ${audioChunks.length}...`);
        
        const form = new FormData();
        form.append('file', audioChunks[i], 'chunk.mp3');
        form.append('model', 'whisper-1');

        const apiUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        const openaiResponse = await fetch(`${apiUrl}/audio/transcriptions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form
        });

        const data = await openaiResponse.json();
        if (data.text) {
          transcripts.push(data.text);
        }
      }
      
      fullTranscript = transcripts.join(' ');
    }

    if (fullTranscript) {
      // Если текст очень длинный, разбиваем на несколько сообщений
      const MAX_MESSAGE_LENGTH = 4000;
      for (let i = 0; i < fullTranscript.length; i += MAX_MESSAGE_LENGTH) {
        await ctx.reply(fullTranscript.substring(i, i + MAX_MESSAGE_LENGTH));
      }
    } else {
      await ctx.reply('Не удалось распознать. Проверьте качество записи.');
    }

  } catch (error) {
    console.error('Ошибка при обработке аудио:', error);
    await ctx.reply('Произошла ошибка при обработке. Попробуйте еще раз.');
  }
});

bot.on('text', (ctx) => {
  ctx.reply('Пожалуйста, отправьте аудио, видео или голосовое сообщение для расшифровки.');
});

// Запуск бота
bot.launch().then(() => console.log('Бот успешно запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// --- Веб-сервер-заглушка для Render ---
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
}).listen(PORT, () => {
  console.log(`Сервер-заглушка запущен на порту ${PORT}`);
});
