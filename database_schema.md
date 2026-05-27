# Структура таблиц базы данных - Система управления проектами

## Таблица: customuser (Пользователи системы)

| Поле        | Тип данных   | Описание                                   |
| ----------- | ------------ | ------------------------------------------ |
| id          | INTEGER      | Первичный ключ                             |
| username    | VARCHAR(150) | Уникальное имя пользователя                |
| email       | VARCHAR(254) | Email адрес                                |
| password    | VARCHAR(128) | Хэш пароля                                 |
| first_name  | VARCHAR(150) | Имя                                        |
| last_name   | VARCHAR(150) | Фамилия                                    |
| role        | VARCHAR(20)  | Роль пользователя (ADMIN/MANAGER/EMPLOYEE) |
| phone       | VARCHAR(30)  | Номер телефона                             |
| domain      | VARCHAR(100) | Домен специализации                        |
| avatar      | VARCHAR(100) | Путь к файлу аватара                       |
| is_active   | BOOLEAN      | Активность учетной записи                  |
| date_joined | DATETIME     | Дата регистрации                           |
| last_login  | DATETIME     | Последний вход                             |

## Таблица: employeeprofile (Профили сотрудников)

| Поле                | Тип данных    | Описание                     |
| ------------------- | ------------- | ---------------------------- |
| id                  | INTEGER       | Первичный ключ               |
| user_id             | INTEGER       | Внешний ключ → customuser.id |
| position            | VARCHAR(100)  | Должность                    |
| domain              | VARCHAR(100)  | Домен специализации          |
| hourly_rate         | DECIMAL(10,2) | Почасовая ставка             |
| bio                 | TEXT          | Биография                    |
| telegram_chat_id    | VARCHAR(100)  | ID чата Telegram             |
| notify_telegram     | BOOLEAN       | Уведомления в Telegram       |
| notify_email        | BOOLEAN       | Email уведомления            |
| notify_daily_digest | BOOLEAN       | Ежедневный дайджест          |

## Таблица: skill (Навыки)

| Поле     | Тип данных   | Описание                     |
| -------- | ------------ | ---------------------------- |
| id       | INTEGER      | Первичный ключ               |
| name     | VARCHAR(100) | Название навыка (уникальное) |
| category | VARCHAR(100) | Категория навыка             |

## Таблица: employeeskill (Навыки сотрудников)

| Поле             | Тип данных | Описание                          |
| ---------------- | ---------- | --------------------------------- |
| id               | INTEGER    | Первичный ключ                    |
| employee_id      | INTEGER    | Внешний ключ → employeeprofile.id |
| skill_id         | INTEGER    | Внешний ключ → skill.id           |
| level            | INTEGER    | Уровень владения (1-5)            |
| years_experience | FLOAT      | Годы опыта                        |

_Уникальный индекс: (employee_id, skill_id)_

## Таблица: workloadentry (Записи о загрузке)

| Поле         | Тип данных   | Описание                                |
| ------------ | ------------ | --------------------------------------- |
| id           | INTEGER      | Первичный ключ                          |
| employee_id  | INTEGER      | Внешний ключ → employeeprofile.id       |
| project_id   | INTEGER      | Внешний ключ → project.id (опционально) |
| start_date   | DATE         | Дата начала                             |
| end_date     | DATE         | Дата окончания                          |
| load_percent | INTEGER      | Процент загрузки (0-100)                |
| note         | VARCHAR(255) | Примечание                              |

## Таблица: projectparticipation (Участие в проектах)

| Поле              | Тип данных   | Описание                          |
| ----------------- | ------------ | --------------------------------- |
| id                | INTEGER      | Первичный ключ                    |
| employee_id       | INTEGER      | Внешний ключ → employeeprofile.id |
| project_id        | INTEGER      | Внешний ключ → project.id         |
| role              | VARCHAR(100) | Роль в проекте                    |
| performance_score | FLOAT        | Оценка результативности (0.0-1.0) |
| joined_at         | DATE         | Дата присоединения                |
| left_at           | DATE         | Дата ухода                        |

## Таблица: employeecertificate (Сертификаты сотрудников)

| Поле            | Тип данных   | Описание                          |
| --------------- | ------------ | --------------------------------- |
| id              | INTEGER      | Первичный ключ                    |
| employee_id     | INTEGER      | Внешний ключ → employeeprofile.id |
| name            | VARCHAR(255) | Название сертификата              |
| issuer          | VARCHAR(255) | Выдавшая организация              |
| credential_id   | VARCHAR(100) | Номер/ID сертификата              |
| issued_date     | DATE         | Дата выдачи                       |
| expiry_date     | DATE         | Дата истечения                    |
| certificate_url | VARCHAR(500) | Ссылка на верификацию             |
| created_at      | DATETIME     | Дата создания записи              |

## Таблица: employeeunavailability (Недоступность сотрудников)

| Поле        | Тип данных  | Описание                          |
| ----------- | ----------- | --------------------------------- |
| id          | INTEGER     | Первичный ключ                    |
| employee_id | INTEGER     | Внешний ключ → employeeprofile.id |
| type        | VARCHAR(20) | Тип недоступности                 |
| start_date  | DATE        | Дата начала                       |
| end_date    | DATE        | Дата окончания                    |
| note        | TEXT        | Примечание                        |
| created_at  | DATETIME    | Дата создания                     |

## Таблица: project (Проекты)

| Поле        | Тип данных    | Описание                       |
| ----------- | ------------- | ------------------------------ |
| id          | INTEGER       | Первичный ключ                 |
| name        | VARCHAR(255)  | Название проекта               |
| description | TEXT          | Описание проекта               |
| domain      | VARCHAR(100)  | Домен проекта                  |
| start_date  | DATE          | Дата начала                    |
| end_date    | DATE          | Дата окончания                 |
| status      | VARCHAR(20)   | Статус проекта                 |
| manager_id  | INTEGER       | Внешний ключ → customuser.id   |
| calendar_id | INTEGER       | Внешний ключ → workcalendar.id |
| budget      | DECIMAL(14,2) | Бюджет проекта                 |
| created_at  | DATETIME      | Дата создания                  |
| updated_at  | DATETIME      | Дата обновления                |

## Таблица: projectmember (Участники проектов)

| Поле                  | Тип данных  | Описание                      |
| --------------------- | ----------- | ----------------------------- |
| id                    | INTEGER     | Первичный ключ                |
| project_id            | INTEGER     | Внешний ключ → project.id     |
| user_id               | INTEGER     | Внешний ключ → customuser.id  |
| role                  | VARCHAR(30) | Роль в проекте                |
| role_ref_id           | INTEGER     | Внешний ключ → projectrole.id |
| allocation_percentage | INTEGER     | Процент занятости             |
| joined_at             | DATE        | Дата присоединения            |

_Уникальный индекс: (project_id, user_id)_

## Таблица: planningblock (Блоки планирования)

| Поле                | Тип данных   | Описание                           |
| ------------------- | ------------ | ---------------------------------- |
| id                  | INTEGER      | Первичный ключ                     |
| name                | VARCHAR(255) | Название блока                     |
| domain              | VARCHAR(100) | Домен блока                        |
| is_template         | BOOLEAN      | Является ли шаблоном               |
| parent_id           | INTEGER      | Внешний ключ → planningblock.id    |
| order               | INTEGER      | Порядок следования                 |
| process_template_id | INTEGER      | Внешний ключ → workflowtemplate.id |
| avg_duration        | INTEGER      | Средняя длительность (дни)         |
| complexity          | VARCHAR(20)  | Сложность                          |
| success_rate        | FLOAT        | Показатель успешности              |
| project_id          | INTEGER      | Внешний ключ → project.id          |
| calendar_id         | INTEGER      | Внешний ключ → workcalendar.id     |
| created_at          | DATETIME     | Дата создания                      |

## Таблица: task (Задачи)

| Поле                | Тип данных   | Описание                                     |
| ------------------- | ------------ | -------------------------------------------- |
| id                  | INTEGER      | Первичный ключ                               |
| block_id            | INTEGER      | Внешний ключ → planningblock.id              |
| parent_id           | INTEGER      | Внешний ключ → task.id (родительская задача) |
| name                | VARCHAR(255) | Название задачи                              |
| description         | TEXT         | Описание задачи                              |
| duration_days       | INTEGER      | Длительность в днях                          |
| start_offset_days   | INTEGER      | Смещение начала                              |
| start_date          | DATE         | Дата начала                                  |
| end_date            | DATE         | Дата окончания                               |
| assigned_to_id      | INTEGER      | Внешний ключ → customuser.id                 |
| status              | VARCHAR(20)  | Статус задачи                                |
| order               | INTEGER      | Порядок                                      |
| process_template_id | INTEGER      | Внешний ключ → workflowtemplate.id           |
| weight              | INTEGER      | Вес задачи                                   |
| priority            | VARCHAR(20)  | Приоритет                                    |
| estimated_hours     | FLOAT        | Оценка часов                                 |
| risk_level          | VARCHAR(20)  | Уровень риска                                |
| workflow_task_id    | INTEGER      | Внешний ключ → workflowtask.id               |
| is_critical         | BOOLEAN      | Критическая задача                           |

## Таблица: taskdependency (Зависимости задач)

| Поле         | Тип данных  | Описание                                   |
| ------------ | ----------- | ------------------------------------------ |
| id           | INTEGER     | Первичный ключ                             |
| from_task_id | INTEGER     | Внешний ключ → task.id (предыдущая задача) |
| to_task_id   | INTEGER     | Внешний ключ → task.id (следующая задача)  |
| type         | VARCHAR(10) | Тип зависимости (FS/SS/FF/SF)              |

## Таблица: auditlog (Журнал аудита)

| Поле       | Тип данных   | Описание                     |
| ---------- | ------------ | ---------------------------- |
| id         | INTEGER      | Первичный ключ               |
| project_id | INTEGER      | Внешний ключ → project.id    |
| user_id    | INTEGER      | Внешний ключ → customuser.id |
| action     | VARCHAR(255) | Действие                     |
| detail     | JSON         | Детали действия              |
| created_at | DATETIME     | Дата создания                |

## Таблица: globalsetting (Глобальные настройки)

| Поле        | Тип данных   | Описание                    |
| ----------- | ------------ | --------------------------- |
| id          | INTEGER      | Первичный ключ              |
| key         | VARCHAR(100) | Ключ настройки (уникальный) |
| value       | VARCHAR(255) | Значение настройки          |
| description | TEXT         | Описание настройки          |
| updated_at  | DATETIME     | Дата обновления             |

## Таблица: notification (Уведомления)

| Поле         | Тип данных   | Описание                     |
| ------------ | ------------ | ---------------------------- |
| id           | INTEGER      | Первичный ключ               |
| recipient_id | INTEGER      | Внешний ключ → customuser.id |
| title        | VARCHAR(255) | Заголовок уведомления        |
| body         | TEXT         | Текст уведомления            |
| type         | VARCHAR(30)  | Тип уведомления              |
| is_read      | BOOLEAN      | Прочитано ли                 |
| link         | VARCHAR(500) | Ссылка                       |
| task_id      | INTEGER      | ID связанной задачи          |
| project_id   | INTEGER      | ID связанного проекта        |
| created_at   | DATETIME     | Дата создания                |

## Таблица: workcalendar (Рабочие календари)

| Поле       | Тип данных   | Описание               |
| ---------- | ------------ | ---------------------- |
| id         | INTEGER      | Первичный ключ         |
| name       | VARCHAR(100) | Название календаря     |
| is_default | BOOLEAN      | Календарь по умолчанию |

## Таблица: calendarholiday (Праздничные дни)

| Поле        | Тип данных   | Описание                       |
| ----------- | ------------ | ------------------------------ |
| id          | INTEGER      | Первичный ключ                 |
| calendar_id | INTEGER      | Внешний ключ → workcalendar.id |
| date        | DATE         | Дата праздника                 |
| name        | VARCHAR(255) | Название праздника             |

_Уникальный индекс: (calendar_id, date)_

## Таблица: risk (Риски)

| Поле        | Тип данных   | Описание        |
| ----------- | ------------ | --------------- |
| id          | INTEGER      | Первичный ключ  |
| name        | VARCHAR(255) | Название риска  |
| description | TEXT         | Описание риска  |
| probability | VARCHAR(20)  | Вероятность     |
| impact      | VARCHAR(20)  | Влияние         |
| mitigation  | TEXT         | Меры mitigation |

## Таблица: projectrole (Роли в проектах)

| Поле        | Тип данных   | Описание                   |
| ----------- | ------------ | -------------------------- |
| id          | INTEGER      | Первичный ключ             |
| name        | VARCHAR(100) | Название роли (уникальное) |
| description | TEXT         | Описание роли              |

## Таблица: projectdomain (Домены проектов)

| Поле        | Тип данных   | Описание                     |
| ----------- | ------------ | ---------------------------- |
| id          | INTEGER      | Первичный ключ               |
| name        | VARCHAR(100) | Название домена (уникальное) |
| description | TEXT         | Описание домена              |

## Таблица: planningblockrisk (Риски блоков планирования)

| Поле     | Тип данных | Описание                        |
| -------- | ---------- | ------------------------------- |
| id       | INTEGER    | Первичный ключ                  |
| block_id | INTEGER    | Внешний ключ → planningblock.id |
| risk_id  | INTEGER    | Внешний ключ → risk.id          |

## Таблица: taskrequiredrole (Требуемые роли для задач)

| Поле    | Тип данных | Описание                      |
| ------- | ---------- | ----------------------------- |
| id      | INTEGER    | Первичный ключ                |
| task_id | INTEGER    | Внешний ключ → task.id        |
| role_id | INTEGER    | Внешний ключ → projectrole.id |

_Уникальный индекс: (task_id, role_id)_

## Таблица: workflowtemplate (Шаблоны процессов)

| Поле          | Тип данных   | Описание                     |
| ------------- | ------------ | ---------------------------- |
| id            | INTEGER      | Первичный ключ               |
| name          | VARCHAR(255) | Название шаблона             |
| description   | TEXT         | Описание шаблона             |
| version       | INTEGER      | Версия шаблона               |
| is_published  | BOOLEAN      | Опубликован ли               |
| created_by_id | INTEGER      | Внешний ключ → customuser.id |
| created_at    | DATETIME     | Дата создания                |
| updated_at    | DATETIME     | Дата обновления              |

## Таблица: workflowtasktemplate (Шаблоны задач процессов)

| Поле                 | Тип данных   | Описание                           |
| -------------------- | ------------ | ---------------------------------- |
| id                   | INTEGER      | Первичный ключ                     |
| template_id          | INTEGER      | Внешний ключ → workflowtemplate.id |
| name                 | VARCHAR(255) | Название задачи                    |
| description          | TEXT         | Описание задачи                    |
| task_type            | VARCHAR(20)  | Тип задачи                         |
| order                | INTEGER      | Порядок                            |
| sla_hours            | INTEGER      | SLA в часах                        |
| is_parallel          | BOOLEAN      | Параллельное выполнение            |
| weight               | INTEGER      | Вес задачи                         |
| priority             | VARCHAR(20)  | Приоритет                          |
| estimated_hours      | FLOAT        | Оценка часов                       |
| risk_level           | VARCHAR(20)  | Уровень риска                      |
| transition_condition | JSON         | Условие перехода                   |
| auto_approve         | BOOLEAN      | Автоутверждение                    |
| integration_url      | VARCHAR(500) | URL интеграции                     |
| integration_config   | JSON         | Конфигурация интеграции            |
| checklist            | JSON         | Чек-лист                           |

## Таблица: workflowinstance (Экземпляры процессов)

| Поле          | Тип данных   | Описание                           |
| ------------- | ------------ | ---------------------------------- |
| id            | INTEGER      | Первичный ключ                     |
| template_id   | INTEGER      | Внешний ключ → workflowtemplate.id |
| project_id    | INTEGER      | Внешний ключ → project.id          |
| name          | VARCHAR(255) | Название экземпляра                |
| status        | VARCHAR(20)  | Статус процесса                    |
| started_at    | DATETIME     | Дата начала                        |
| completed_at  | DATETIME     | Дата завершения                    |
| created_by_id | INTEGER      | Внешний ключ → customuser.id       |

## Таблица: workflowtask (Задачи процессов)

| Поле                 | Тип данных   | Описание                               |
| -------------------- | ------------ | -------------------------------------- |
| id                   | INTEGER      | Первичный ключ                         |
| workflow_id          | INTEGER      | Внешний ключ → workflowinstance.id     |
| task_template_id     | INTEGER      | Внешний ключ → workflowtasktemplate.id |
| name                 | VARCHAR(255) | Название задачи                        |
| description          | TEXT         | Описание задачи                        |
| task_type            | VARCHAR(20)  | Тип задачи                             |
| status               | VARCHAR(20)  | Статус задачи                          |
| assigned_to_id       | INTEGER      | Внешний ключ → customuser.id           |
| due_date             | DATETIME     | Срок выполнения                        |
| sla_hours            | INTEGER      | SLA в часах                            |
| order                | INTEGER      | Порядок                                |
| weight               | INTEGER      | Вес задачи                             |
| priority             | VARCHAR(20)  | Приоритет                              |
| estimated_hours      | FLOAT        | Оценка часов                           |
| risk_level           | VARCHAR(20)  | Уровень риска                          |
| created_at           | DATETIME     | Дата создания                          |
| updated_at           | DATETIME     | Дата обновления                        |
| started_at           | DATETIME     | Дата начала                            |
| completed_at         | DATETIME     | Дата завершения                        |
| auto_approve         | BOOLEAN      | Автоутверждение                        |
| checklist            | JSON         | Чек-лист                               |
| integration_url      | VARCHAR(500) | URL интеграции                         |
| integration_config   | JSON         | Конфигурация интеграции                |
| linked_wbs_task_id   | INTEGER      | Внешний ключ → task.id                 |
| wbs_block_id         | INTEGER      | Внешний ключ → planningblock.id        |
| transition_condition | JSON         | Условие перехода                       |

## Дополнительные связи

### Many-to-Many связи:

- **project.risks** ↔ **risk** (через неявную таблицу)
- **task.depends_on** ↔ **task** (самоссылающаяся)
- **workflowtask.depends_on** ↔ **workflowtask** (самоссылающаяся)
- **workflowtasktemplate.depends_on** ↔ **workflowtasktemplate** (самоссылающаяся)

### Индексы производительности:

- Уникальные индексы на композитные ключи
- Индексы на внешние ключи для оптимизации запросов
- Индексы на часто используемые поля (status, created_at, updated_at)
