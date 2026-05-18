import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

async function checkBot() {
    if (!token) {
        console.error('❌ TELEGRAM_BOT_TOKEN not found in .env');
        return;
    }

    console.log(`🔍 Checking bot identity for token: ${token.substring(0, 10)}...`);

    try {
        const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
        const bot = response.data.result;
        console.log('✅ Bot found!');
        console.log(`🤖 Name: ${bot.first_name}`);
        console.log(`👤 Username: @${bot.username}`);
        console.log(`🆔 ID: ${bot.id}`);
    } catch (error: any) {
        console.error('❌ Error checking bot:', error.response?.data || error.message);
    }
}

checkBot();
