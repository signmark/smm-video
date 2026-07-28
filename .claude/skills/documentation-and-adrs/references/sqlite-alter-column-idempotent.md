### Проблема: Идемпотентное добавление столбцов в SQLite

SQLite имеет ограниченную поддержку `ALTER TABLE`. В частности, он **не поддерживает** синтаксис `ALTER TABLE ADD COLUMN IF NOT EXISTS <column_name> <column_type>`.

Попытка выполнить такую команду напрямую приведет к ошибке `sqlite3.OperationalError: near "EXISTS": syntax error`.

**Причина:** Отсутствие прямой поддержки `IF NOT EXISTS` для `ADD COLUMN` в SQLite. Стандартные миграционные фреймворки, которые генерируют SQL для других баз данных (например, PostgreSQL), могут создавать несовместимые с SQLite конструкции.

**Решение:** Перед добавлением столбца необходимо вручную проверить его существование в таблице, используя `PRAGMA table_info(<table_name>)`.

**Пример реализации в Python/SQLAlchemy (адаптировано из текущего диалога):**

```python
from sqlalchemy import text

# ... внутри функции миграции ...

async def _run_lightweight_migrations(session):
    # Список столбцов для добавления:
    migrations = [
        ("goals", "user_id", "VARCHAR"),
        ("daily_tasks", "user_id", "VARCHAR"),
        ("chat_messages", "user_id", "VARCHAR"),
        ("achievements", "user_id", "VARCHAR"),
    ]

    # Сначала выполняем миграции для индексов (поддерживают IF NOT EXISTS)
    index_migrations = [
        "CREATE INDEX IF NOT EXISTS ix_goals_user_id ON goals(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_daily_tasks_user_id ON daily_tasks(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_chat_messages_user_id ON chat_messages(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_achievements_user_id ON achievements(user_id)",
    ]
    for sql in index_migrations:
        try:
            await session.execute(text(sql))
            await session.commit()
            # ... logging ...
        except Exception as mig_err:
            await session.rollback()
            # ... logging warning ...

    # Затем добавляем столбцы, проверяя их существование
    for table_name, column_name, column_type in migrations:
        try:
            # Проверяем, существует ли столбец
            result = await session.execute(text(f"PRAGMA table_info({table_name})"))
            columns = [row[1] for row in result.fetchall()]

            if column_name not in columns:
                alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                await session.execute(text(alter_sql))
                await session.commit()
                # ... logging ...
            else:
                # ... logging info (skipped) ...
                pass
        except Exception as mig_err:
            await session.rollback()
            # ... logging warning ...

```

**Важно:** Этот подход обеспечивает идемпотентность и совместимость с SQLite, предотвращая ошибки синтаксиса при повторных запусках миграций.