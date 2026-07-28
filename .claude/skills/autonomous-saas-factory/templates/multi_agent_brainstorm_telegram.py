#!/usr/bin/env python3
import asyncio
import os
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime

# ANSI colors for terminal formatting
C_GREEN = "\033[1;32m"
C_BLUE = "\033[1;34m"
C_CYAN = "\033[1;36m"
C_YELLOW = "\033[1;33m"
C_RED = "\033[1;31m"
C_MAGENTA = "\033[1;35m"
C_BOLD = "\033[1m"
C_RESET = "\033[0m"

# Ensure we use the proper python path and virtual environment
sys.path.append("/home/signmark/hermes-venv/lib/python3.12/site-packages")

from metagpt.llm import LLM
from metagpt.config2 import config

# Validate that the LLM config is loaded
if not config.llm.api_key or config.llm.api_key == "YOUR_API_KEY":
    print(f"{C_RED}❌ Error: API Key not properly configured in MetaGPT.{C_RESET}")
    sys.exit(1)

# Helper function to load Telegram Bot Token from environment or fallback .env file
def get_bot_token():
    # 1. Check direct environment variable
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if token:
        return token
    
    # 2. Check standard Hermes .env file
    try:
        env_path = os.path.expanduser("~/.hermes/.env")
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                for line in f:
                    if line.startswith("TELEGRAM_BOT_TOKEN="):
                        return line.split("=", 1)[1].strip()
    except Exception as e:
        print(f"Error loading bot token from .env: {e}")
    return None

BOT_TOKEN = get_bot_token()
# Set target chat ID (public username like '@my_channel' or numerical ID)
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "@craft_podium")

def send_telegram_message(text):
    if not BOT_TOKEN:
        print("Telegram Token not found, skipping Telegram post.")
        return
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    
    # Simple chunking to avoid Telegram 4096 character limit
    chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
    for chunk in chunks:
        payload = {
            "chat_id": CHAT_ID,
            "text": chunk,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req) as response:
                pass
        except Exception as e:
            print(f"Failed to send to Telegram: {e}")

class AgentCharacter:
    def __init__(self, name: str, role: str, color: str, emoji: str, system_prompt: str):
        self.name = name
        self.role = role
        self.color = color
        self.emoji = emoji
        self.system_prompt = system_prompt

# Define the team characters with distinct personalities and priorities
agents = [
    AgentCharacter(
        name="Кира 'Метрика'",
        role="Product Manager",
        color=C_MAGENTA,
        emoji="🎯",
        system_prompt="""Ты — Кира 'Метрика', опытный Product Manager в SaaS-стартапах.
Твой фокус: Product-Market Fit (PMF), Retention, Jobs-To-Be-Done (JTBD), Unit-экономика и LTV.
Ты прагматична, всегда возвращаешь команду к реальности и к пользователю. Задаешь неудобные вопросы: "Какую боль мы решаем?", "За что конкретно они заплатят?", "Как это повлияет на удержание?".
Стиль общения: профессиональный, конструктивный, слегка ироничный, использует продуктовую терминологию, но без занудства. Ненавидит сложные интерфейсы, ценит простоту (KISS).
"""
    ),
    AgentCharacter(
        name="Алекс 'Гроух'",
        role="Smart Marketer / Growth Hacker",
        color=C_GREEN,
        emoji="🚀",
        system_prompt="""Ты — Алекс 'Гроух', безжалостный Growth-хакер и маркетолог.
Твой фокус: Трафик, конверсии, лид-магниты, виральные петли, триггеры дефицита и психология внимания.
Ты ненавидишь "красивый бренд-маркетинг без продаж". Твоя цель — затащить пользователя в воронку любой ценой, используя дерзкие заходы, автокомменты, Reels/Shorts тренды и ИИ-персонализацию.
Стиль общения: драйвовый, агрессивный в хорошем смысле, эмоциональный, использует маркет-сленг (CPA, лид-магнит, прогрев, дожим, автоворонка). Постоянно генерирует дикие, но рабочие идеи.
"""
    ),
    AgentCharacter(
        name="Влад 'Транзистор'",
        role="Funnel Developer / Automator",
        color=C_CYAN,
        emoji="💻",
        system_prompt="""Ты — Влад 'Транзистор', системный архитектор автоворонок и бэкенд-разработчик.
Твой фокус: n8n, FastAPI, PostgreSQL, Directus, Telegram WebApps, интеграции API и отказоустойчивость.
Ты режешь безумные фантазии маркетолога, переводя их на язык "схем данных, лимитов API и сложности разработки". Обожает лаконичный работающий софт. Если что-то можно сделать простым вебхуком в n8n вместо написания 1000 строк кода, ты сделаешь это вебхуком.
Стиль общения: сухой, технический, циничный, прямолинейный. Любит сарказм. Начинает фразы с "Так, стоп..." или "Физически это взлетит, но...".
"""
    ),
    AgentCharacter(
        name="Ярослав 'Оффер'",
        role="Sales Coach / Lead Closer",
        color=C_YELLOW,
        emoji="🤝",
        system_prompt="""Ты — Ярослав 'Оффер', эксперт по продажам, конверсии лидов и дожиму до оплаты.
Твой фокус: Обработка возражений, персонализированные офферы, триггерные рассылки, голосовые ИИ-сообщения от фаундера, демо-звонки и закрытие брошенных корзин.
Ты знает всё о поведении покупателей на этапе "хочу, но сомневаюсь". Твоя цель — чтобы ни один лид, проявивший интерес, не ушел без попытки продажи.
Стиль общения: харизматичный, убедительный, ориентированный на деньги и продажи, использует сленг продажников (оффер, апсейл, даунсейл, возражение, брошенная корзина, триггер).
"""
    )
]

class BrainstormManager:
    def __init__(self, topic: str):
        self.topic = topic
        self.history = []
        self.llm = LLM()
        
    def add_message(self, author: str, role: str, content: str):
        self.history.append({
            "author": author,
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })

    def format_history_for_llm(self) -> str:
        formatted = ""
        for msg in self.history[-8:]:  # Keep recent context window for high quality
            formatted += f"[{msg['author']} ({msg['role']})]:\n{msg['content']}\n\n"
        return formatted

    async def get_response(self, agent: AgentCharacter) -> str:
        prompt = f"""{agent.system_prompt}

Мы проводим живой рабочий брейншторм команды стартапа.
ТЕМА БРЕЙНШТОРМА: {self.topic}

История обсуждения:
{self.format_history_for_llm()}

Твоя задача: отреагировать на предыдущие реплики коллег со своей профессиональной колокольни.
- Проанализируй их предложения (поддержи, раскритикуй конструктивно, предложи оптимизацию).
- Предложи свое конкретное, применимое решение.
- Избегай пустых соглашательств ("Отличная идея, я согласен!"). Спорь, если видишь баги или слабые конверсии!
- Пиши ЖИВЫМ, разговорным языком (на русском), без канцелярщины, как в рабочем чате Telegram или на созвоне в Discord. Никаких формальных "Уважаемый Влад...". Общайся свободно, весело, жестко и по делу.

Выдай только свою реплику без дополнительных оберток и подписей."""
        
        response = await self.llm.aask(prompt)
        return response.strip()

    async def run_brainstorm(self, rounds: int = 2):
        print(f"\n{C_BLUE}{C_BOLD}🚀 ЗАПУСК СВЕРХДИНАМИЧНОГО БРЕЙНШТОРМА КОМАНДЫ В TELEGRAM{C_RESET}")
        print(f"📌 Тема: {C_YELLOW}{self.topic}{C_RESET}\n")
        
        # Post Kickoff header to Telegram
        kickoff_header = (
            f"<b>🚀 ЗАПУСК СВЕРХДИНАМИЧНОГО БРЕЙНШТОРМА КОМАНДЫ</b>\n\n"
            f"📌 <b>Тема:</b> <i>{self.topic}</i>\n\n"
            f"👥 <b>Участники:</b>\n"
            f"🎯 <b>Кира 'Метрика'</b> (Product Manager)\n"
            f"🚀 <b>Алекс 'Гроух'</b> (Growth Hacker / Маркетолог)\n"
            f"💻 <b>Влад 'Транзистор'</b> (Automator / Разработчик)\n"
            f"🤝 <b>Ярослав 'Оффер'</b> (Sales Coach / Дожим)"
        )
        send_telegram_message(kickoff_header)
        await asyncio.sleep(2)
        
        # Kickoff with Product Manager setting the stage
        pm = agents[0] # Kira
        kickoff_prompt = f"""Ты открываешь брейншторм по теме: "{self.topic}".
Задай тон, кратко обрисуй задачу и вовлеки команду (маркетолога Алекса, технаря Влада, продажника Ярослава).
Напиши короткий, емкий вводный спич лидера команды на русском, живым рабочим языком."""
        
        kickoff = await self.llm.aask(kickoff_prompt)
        print(f"{pm.color}{C_BOLD}[{pm.name} ({pm.role})]{C_RESET}")
        print(f"{kickoff}\n")
        
        # Format and send to Telegram
        tg_kickoff = f"{pm.emoji} <b>[{pm.name} ({pm.role})]:</b>\n\n{kickoff}"
        send_telegram_message(tg_kickoff)
        self.add_message(pm.name, pm.role, kickoff)
        
        # Loop through roles for dynamic debate
        for r in range(rounds):
            print(f"{C_YELLOW}--- Раунд {r+1} ---{C_RESET}\n")
            round_divider = f"<b>--- Раунд {r+1} ---</b>"
            send_telegram_message(round_divider)
            await asyncio.sleep(2)
            
            # Rotate other agents (Marketer, Automator, Sales, and then PM again)
            for agent in agents[1:] + [agents[0]]:
                await asyncio.sleep(3) # Give Dmitry time to read in real-time!
                
                response = await self.get_response(agent)
                print(f"{agent.color}{C_BOLD}[{agent.name} ({agent.role})]{C_RESET}")
                print(f"{response}\n")
                
                # Format and send to Telegram
                tg_msg = f"{agent.emoji} <b>[{agent.name} ({agent.role})]:</b>\n\n{response}"
                send_telegram_message(tg_msg)
                self.add_message(agent.name, agent.role, response)

        # Final Synthesis Action: Product Manager compiles the final actionable decision
        print(f"{C_BLUE}{C_BOLD}📊 ФОРМИРОВАНИЕ ИТОГОВОГО РЕШЕНИЯ...{C_RESET}")
        synth_header = "<b>📊 ФОРМИРОВАНИЕ ИТОГОВОГО РЕШЕНИЯ И ТЕХНИЧЕСКИХ СПЕЦИФИКАЦИЙ...</b>"
        send_telegram_message(synth_header)
        await asyncio.sleep(2)
        
        synthesis_prompt = f"""Ты — Кира 'Метрика', Product Manager.
Проанализируй весь прошедший брейншторм вашей команды:
{self.format_history_for_llm()}

Сформируй финальный консолидированный документ концепции стартапа и воронки/прогрева для Telegram-канала, который СРАЗУ пойдет в реализацию.

Документ должен быть на русском языке, написан профессионально, емко, структурировано и содержать:
1. **Суть концепта (Product-Market Fit & Value Proposition)**
2. **План прогрева для канала (Content & Funnel Strategy)**
3. **Вовлекающий сценарий / Сюжетная линия видео / лид-магнита**
4. **Схема автоматизации и стек**
5. **Конкретный Backlog задач (Action Items)** для каждого члена команды.

Выдай этот документ в чистом Markdown."""
        
        synthesis = await self.llm.aask(synthesis_prompt)
        
        # Save to file
        docs_dir = "./docs"
        os.makedirs(docs_dir, exist_ok=True)
        file_path = os.path.join(docs_dir, "brainstorm_output.md")
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(f"# Результат Брейншторма: {self.topic}\n")
            f.write(f"*Сгенерировано мультиагентной командой MetaGPT: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
            f.write("## 💬 Транскрипт брейншторма (выжимка диалога)\n\n")
            for msg in self.history:
                f.write(f"**[{msg['author']} - {msg['role']}]:** {msg['content']}\n\n")
            f.write("---\n\n")
            f.write("## 🎯 Финальная Стратегия & Технические Спецификации\n\n")
            f.write(synthesis)
            
        print(f"{C_GREEN}✅ Спецификация успешно создана и сохранена по адресу: {C_BOLD}{file_path}{C_RESET}\n")
        
        # Post Final Synthesis to Telegram
        send_telegram_message(f"🎯 <b>ФИНАЛЬНАЯ СТРАТЕГИЯ И ТЕХНИЧЕСКИЕ СПЕЦИФИКАЦИЙ:</b>\n\n{synthesis}")
        return file_path

async def main():
    topic = "Личная операционная система (Personal OS) в Obsidian + ИИ-агенты. Цель: сделать прорывное видео и серию постов для канала @craft_podium о том, как собрать свои большие данные в единую базу знаний."
    manager = BrainstormManager(topic)
    await manager.run_brainstorm(rounds=2)

if __name__ == "__main__":
    asyncio.run(main())
