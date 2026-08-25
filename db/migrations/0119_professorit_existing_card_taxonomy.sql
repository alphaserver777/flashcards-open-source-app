-- Migration status: Current / data classification.
-- Classifies the existing Professor IT Linux and Git catalog and links it to stable LMS lessons.

UPDATE content.professorit_shared_cards AS card
SET
  subject_slug = 'git',
  topic_slug = CASE
    WHEN card.stable_card_key ~ '^git-0(18|19|20|21|22|23|24|25)-' THEN 'branches'
    WHEN card.stable_card_key ~ '^git-0(26|27|28|29|30|41|42|43|50)-' THEN 'remote'
    WHEN card.stable_card_key ~ '^git-0(31|32|33|34|35|36|37|38|39|40|49)-' THEN 'recovery'
    WHEN card.stable_card_key ~ '^git-0(44|45|46|47|48)-' THEN 'workflow'
    ELSE 'basics'
  END,
  difficulty = CASE
    WHEN card.stable_card_key ~ '^git-0(23|29|43|46|47)-' THEN 'senior'
    WHEN card.stable_card_key ~ '^git-0(22|24|25|27|30|31|32|33|34|35|36|37|38|39|40|41|44|48|49|50)-' THEN 'middle'
    ELSE 'junior'
  END,
  question_type = CASE
    WHEN lower(card.front_text) ~ '(как|какие команды|что делать|порядок)' THEN 'command'
    WHEN lower(card.front_text) ~ '(почему|неудач|ошибк|восстанов|опасн)' THEN 'case'
    ELSE 'theory'
  END,
  lms_lesson_id = CASE
    WHEN card.stable_card_key ~ '^git-0(18|19|20|21|22|23|24|25)-' THEN '0026 Ветвление и слияние'
    WHEN card.stable_card_key ~ '^git-0(26|27|28|29|30|41|42|43|50)-' THEN '0030 Удалённые репозитории'
    WHEN card.stable_card_key ~ '^git-0(31|32|33|34|35|36|37|38|39|40|49)-' THEN '0758 Опорный конспект: ошибки и восстановление'
    WHEN card.stable_card_key ~ '^git-0(44|45|46|47|48)-' THEN '0759 Подготовка к собеседованию и самопроверка'
    WHEN card.stable_card_key ~ '^git-0(03|04|05|06|07|08|09|10|12|13)-' THEN '0060 Три зоны Git и путь изменений'
    ELSE '0018 Введение в Git'
  END,
  lms_lesson_title = CASE
    WHEN card.stable_card_key ~ '^git-0(18|19|20|21|22|23|24|25)-' THEN 'Ветвление и слияние'
    WHEN card.stable_card_key ~ '^git-0(26|27|28|29|30|41|42|43|50)-' THEN 'Удалённые репозитории'
    WHEN card.stable_card_key ~ '^git-0(31|32|33|34|35|36|37|38|39|40|49)-' THEN 'Опорный конспект: ошибки и восстановление'
    WHEN card.stable_card_key ~ '^git-0(44|45|46|47|48)-' THEN 'Подготовка к собеседованию и самопроверка'
    WHEN card.stable_card_key ~ '^git-0(03|04|05|06|07|08|09|10|12|13)-' THEN 'Три зоны Git и путь изменений'
    ELSE 'Зачем нужен Git и как его настроить'
  END,
  updated_at = now()
FROM catalog.packages AS package
WHERE package.package_id = card.package_id
  AND package.slug = 'professor-it-git-foundation';

UPDATE content.professorit_shared_cards AS card
SET
  subject_slug = 'linux',
  topic_slug = CASE
    WHEN lower(card.front_text) ~ '(pid|процесс|fork|zombie|orphan|load average|oom|cpu|памят|swap|nice|iowait|steal|huge page|overcommit|tini|dumb-init)' THEN 'processes'
    WHEN lower(card.front_text) ~ '(disk|диск|inode|lvm|файлов|(^|[^a-z])df([^a-z]|$)|(^|[^a-z])du([^a-z]|$)|mount|smart|iostat|await|%util|имя файла)' THEN 'storage'
    WHEN lower(card.front_text) ~ '(systemd|systemctl|unit|journalctl|journald|restart=|network.target)' THEN 'systemd'
    WHEN lower(card.front_text) ~ '(порт|сетев|маршрут|dns|resolv|hosts|tcpdump)' THEN 'network'
    WHEN lower(card.front_text) ~ '(rwx|chmod|chown|владел|umask|acl|suid|sgid|sticky)' THEN 'permissions'
    WHEN lower(card.front_text) ~ '(strace|lsof|/proc)' THEN 'diagnostics'
    ELSE 'fundamentals'
  END,
  difficulty = CASE
    WHEN lower(card.front_text) ~ '(memory overcommit|tini|dumb-init|huge page|почему важен pid 1 в контейнере)' THEN 'senior'
    WHEN lower(card.front_text) ~ '(почему|можно ли|разница|отличается|высок|близкий|норма|убить|найти|проверить|как добавить|как изменить|как посмотреть|как смотреть)' THEN 'middle'
    ELSE 'junior'
  END,
  question_type = CASE
    WHEN lower(card.front_text) ~ '(как|команд|утилит)' THEN 'command'
    WHEN lower(card.front_text) ~ '(почему|высок|близкий|нельзя|норма)' THEN 'case'
    ELSE 'theory'
  END,
  lms_lesson_id = CASE
    WHEN lower(card.front_text) ~ '(pid|процесс|fork|zombie|orphan|load average|oom|cpu|памят|swap|nice|iowait|steal|huge page|overcommit|tini|dumb-init)' THEN '0431 Теория. Процессы и ресурсы'
    WHEN lower(card.front_text) ~ '(disk|диск|inode|lvm|файлов|(^|[^a-z])df([^a-z]|$)|(^|[^a-z])du([^a-z]|$)|mount|smart|iostat|await|%util|имя файла)' THEN '0439 Теория. Диски и файловые системы'
    WHEN lower(card.front_text) ~ '(systemd|systemctl|unit|journalctl|journald|restart=|network.target)' THEN '0443 Теория. Загрузка системы, systemd и планировщики'
    WHEN lower(card.front_text) ~ '(порт|сетев|маршрут|dns|resolv|hosts|tcpdump)' THEN '0448 Теория. Сеть на Linux-сервере'
    WHEN lower(card.front_text) ~ '(rwx|chmod|chown|владел|umask|acl|suid|sgid|sticky)' THEN '0426 Теория. Права доступа'
    WHEN lower(card.front_text) ~ '(strace|lsof|/proc)' THEN '0460 Теория. Журналы, диагностика и восстановление'
    ELSE '0398 Теория. Как устроен Linux'
  END,
  lms_lesson_title = CASE
    WHEN lower(card.front_text) ~ '(pid|процесс|fork|zombie|orphan|load average|oom|cpu|памят|swap|nice|iowait|steal|huge page|overcommit|tini|dumb-init)' THEN 'Теория. Процессы и ресурсы'
    WHEN lower(card.front_text) ~ '(disk|диск|inode|lvm|файлов|(^|[^a-z])df([^a-z]|$)|(^|[^a-z])du([^a-z]|$)|mount|smart|iostat|await|%util|имя файла)' THEN 'Теория. Диски и файловые системы'
    WHEN lower(card.front_text) ~ '(systemd|systemctl|unit|journalctl|journald|restart=|network.target)' THEN 'Теория. Загрузка системы, systemd и планировщики'
    WHEN lower(card.front_text) ~ '(порт|сетев|маршрут|dns|resolv|hosts|tcpdump)' THEN 'Теория. Сеть на Linux-сервере'
    WHEN lower(card.front_text) ~ '(rwx|chmod|chown|владел|umask|acl|suid|sgid|sticky)' THEN 'Теория. Права доступа'
    WHEN lower(card.front_text) ~ '(strace|lsof|/proc)' THEN 'Теория. Журналы, диагностика и восстановление'
    ELSE 'Теория. Как устроен Linux'
  END,
  updated_at = now()
FROM catalog.packages AS package
WHERE package.package_id = card.package_id
  AND package.slug = 'professor-it-linux-foundation'
  AND card.publication_status = 'published';
