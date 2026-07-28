#!/usr/bin/env python3
import asyncio
import os
import sys
import json
from datetime import datetime

# Path helper for virtual environment installations
sys.path.append("/home/signmark/hermes-venv/lib/python3.12/site-packages")

from metagpt.llm import LLM
from metagpt.config2 import config

# Validate that the LLM config is loaded
if not config.llm.api_key or config.llm.api_key == "YOUR_API_KEY":
    print("❌ Error: API Key not properly configured in MetaGPT config2.yaml.")
    sys.exit(1)

class AgentCharacter:
    def __init__(self, name: str, role: str, color: str, system_prompt: str):
        self.name = name
        self.role = role
        self.color = color  # ANSI color code
        self.system_prompt = system_prompt

class BrainstormManager:
    def __init__(self, topic: str, agents: list):
        self.topic = topic
        self.agents = agents
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
        # Keep recent 8 turns for high quality contextual response
        for msg in self.history[-8:]:
            formatted += f"[{msg['author']} ({msg['role']})]:\n{msg['content']}\n\n"
        return formatted

    async def get_response(self, agent: AgentCharacter) -> str:
        prompt = f"""{agent.system_prompt}

Мы проводим живой рабочий брейншторм команды стартапа.
ТЕМА БРЕЙНШТОРМА: {self.topic}

История обсуждения:
{self.format_history_for_llm()}

Твоя задача: отреагировать на предыдущие реплики коллег со своей профессиональной колокольни.
- Проанализируй их предложения (поддержи, раскритикуй конструктивно, предложи альтернативу).
- Предложи свое конкретное, применимое решение.
- Избегай пустых соглашательств ("Отличная идея!"). Спорь, если видишь баги или слабые конверсии!
- Пиши ЖИВЫМ, разговорным языком (на русском), без канцелярщины, как в рабочем чате Telegram. Общайся свободно, весело, жестко и по делу.

Выдай только свою реплику без дополнительных оберток и подписей."""
        
        response = await self.llm.aask(prompt)
        return response.strip()

    async def run_brainstorm(self, rounds: int = 2, output_dir: str = "./docs", filename: str = "brainstorm_output.md"):
        print(f"🚀 ЗАПУСК СВЕРХДИНАМИЧНОГО БРЕЙНШТОРМА")
        print(f"📌 Тема: {self.topic}\n")
        
        # Kickoff with Product Manager (always index 0)
        pm = self.agents[0]
        kickoff_prompt = f"""Ты открываешь брейншторм по теме: "{self.topic}".
Задай тон, кратко обрисуй задачу и вовлеки команду.
Напиши короткий, емкий вводный спич лидера команды на русском, живым рабочим языком."""
        
        kickoff = await self.llm.aask(kickoff_prompt)
        print(f"\033[1m[{pm.name} ({pm.role})]\033[0m")
        print(f"{kickoff}\n")
        self.add_message(pm.name, pm.role, kickoff)
        
        # Debate loop
        for r in range(rounds):
            print(f"--- Раунд {r+1} ---\n")
            # Rotate participants
            for agent in self.agents[1:] + [self.agents[0]]:
                await asyncio.sleep(0.5)  # Pace execution
                
                response = await self.get_response(agent)
                print(f"\033[1m[{agent.name} ({agent.role})]\033[0m")
                print(f"{response}\n")
                self.add_message(agent.name, agent.role, response)

        # Synthesize final document
        print(f"📊 ФОРМИРОВАНИЕ ИТОГОВОГО РЕШЕНИЯ И ТЕХНИЧЕСКИХ СПЕЦИФИКАЦИЙ...")
        synthesis_prompt = f"""Ты — {pm.name}, {pm.role}.
Проанализируй весь прошедший брейншторм вашей команды:
{self.format_history_for_llm()}

Сформируй финальный консолидированный документ (спецификацию/стратегию) по теме "{self.topic}", который пойдет в реализацию.
Документ должен быть на русском языке, написан профессионально, емко, структурировано.

Выдай этот документ в чистом Markdown."""
        
        synthesis = await self.llm.aask(synthesis_prompt)
        
        # Save output
        os.makedirs(output_dir, exist_ok=True)
        file_path = os.path.join(output_dir, filename)
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(f"# Результат Брейншторма: {self.topic}\n")
            f.write(f"*Сгенерировано мультиагентной командой MetaGPT: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
            f.write("## 💬 Транскрипт обсуждения\n\n")
            for msg in self.history:
                f.write(f"**[{msg['author']} - {msg['role']}]:** {msg['content']}\n\n")
            f.write("---\n\n")
            f.write("## 🎯 Финальное Решение\n\n")
            f.write(synthesis)
            
        print(f"✅ Результаты успешно сохранены в: {file_path}")
        return file_path

async def main():
    # Example usage
    agents = [
        AgentCharacter("Кира", "Product Manager", "\033[1;35m", "Ты Kira, PM. Твой фокус PMF, JTBD и простота."),
        AgentCharacter("Алекс", "Growth Marketer", "\033[1;32m", "Ты Alex, маркетолог. Ищешь трафик и конверсии любой ценой."),
        AgentCharacter("Влад", "Automator", "\033[1;36m", "Ты Vlad, разработчик. Скептик, пилишь простые надежные схемы.")
    ]
    topic = "Проектирование фичи X"
    manager = BrainstormManager(topic, agents)
    await manager.run_brainstorm(rounds=1)

if __name__ == "__main__":
    asyncio.run(main())
