-- Migration status: Current / seed data.
-- Imports the author's Linux interview-question backlog as drafts.
-- Drafts are deliberately not synchronized to learners until the reference answer is reviewed.

WITH source(question, topic_slug, difficulty, question_type) AS (
  VALUES
    ('Как происходит процесс загрузки Linux пошагово от кнопки включения до приглашения входа?', 'boot', 'senior', 'theory'),
    ('В чём разница между BIOS и UEFI?', 'boot', 'junior', 'theory'),
    ('Что такое init-процесс с PID 1 и какова его роль?', 'boot', 'middle', 'theory'),
    ('Что порождает init-процесс?', 'boot', 'middle', 'theory'),
    ('Чем systemd отличается от SysVinit и почему Linux перешёл на systemd?', 'systemd', 'middle', 'theory'),
    ('В какой ситуации PID 1 не является systemd или init?', 'containers', 'senior', 'case'),
    ('Как узнать версию ядра и дистрибутива Linux?', 'fundamentals', 'junior', 'command'),
    ('Что такое пространство ядра и пространство пользователя и как они взаимодействуют?', 'kernel', 'senior', 'theory'),
    ('Как временно и постоянно изменить параметры ядра через sysctl?', 'kernel', 'middle', 'command'),
    ('Что такое уровни выполнения Linux?', 'boot', 'middle', 'theory'),
    ('Чем процесс отличается от потока и могут ли они существовать друг без друга?', 'processes', 'middle', 'theory'),
    ('Какие бывают состояния процесса R, S, D, Z и T?', 'processes', 'middle', 'theory'),
    ('Что такое zombie-процесс, кто виноват в его появлении и как его убрать?', 'processes', 'middle', 'case'),
    ('Что такое orphan-процесс и чем он отличается от zombie-процесса?', 'processes', 'middle', 'theory'),
    ('Как работает системный вызов fork?', 'processes', 'senior', 'theory'),
    ('Чем SIGTERM отличается от SIGKILL и какой сигнал может привести к zombie-процессу?', 'processes', 'middle', 'case'),
    ('Как рассчитывается Load Average и почему это не процент загрузки процессора?', 'processes', 'middle', 'theory'),
    ('На сервере 12 процессоров, Load Average равен 300, но загрузка процессора 0%. В чём причина?', 'processes', 'senior', 'case'),
    ('Как OOM Killer выбирает процесс для завершения?', 'processes', 'senior', 'theory'),
    ('Чем колонки free и available отличаются в выводе free -h?', 'processes', 'middle', 'theory'),
    ('Что такое очередь выполнения процессов?', 'processes', 'middle', 'theory'),
    ('Как изменить приоритет процесса через nice и renice?', 'processes', 'middle', 'command'),
    ('Что такое inode и какая информация в нём хранится?', 'storage', 'middle', 'theory'),
    ('На диске есть место по df, но файл не создаётся с ошибкой No space left. Как найти причину?', 'storage', 'middle', 'case'),
    ('Можно ли увеличить количество inode на существующей файловой системе?', 'storage', 'middle', 'case'),
    ('Чем ext4, XFS и Btrfs отличаются в работе с inode?', 'storage', 'senior', 'theory'),
    ('Чем df отличается от du?', 'storage', 'junior', 'theory'),
    ('Большой журнал удалили, но место по df не освободилось. Почему и как исправить?', 'storage', 'middle', 'case'),
    ('Чем жёсткая ссылка отличается от символической?', 'storage', 'middle', 'theory'),
    ('Что такое LVM, чем он отличается от RAID и что означают PV, VG и LV?', 'storage', 'middle', 'theory'),
    ('Как добавить новый диск: раздел, файловая система, монтирование и fstab?', 'storage', 'middle', 'command'),
    ('Для чего нужны blkid и UUID файловой системы?', 'storage', 'junior', 'theory'),
    ('Что такое блочное устройство?', 'storage', 'junior', 'theory'),
    ('Что такое Sticky Bit, SUID и SGID?', 'permissions', 'middle', 'theory'),
    ('Как рекурсивно изменить права, владельца и группу каталогов и файлов?', 'permissions', 'middle', 'command'),
    ('Как посмотреть открытые порты и процессы, которые их слушают?', 'network', 'junior', 'command'),
    ('В каких файлах Linux настраивается разрешение доменных имён?', 'network', 'junior', 'theory'),
    ('Как проверить разрешение доменного имени через dig, host и nslookup?', 'network', 'junior', 'command'),
    ('Как посмотреть таблицу маршрутизации Linux?', 'network', 'junior', 'command'),
    ('Что такое протокол ICMP?', 'network', 'junior', 'theory'),
    ('Для чего нужен iptables и как сохранить его правила после перезагрузки?', 'network', 'middle', 'command'),
    ('Что такое UFW и SELinux?', 'security', 'junior', 'theory'),
    ('Как проверить связь между двумя серверами по UDP на заданном порту?', 'network', 'middle', 'case'),
    ('Как скопировать файл между серверами через scp и rsync?', 'ssh', 'junior', 'command'),
    ('Чем su отличается от sudo и когда использовать sudo -i?', 'permissions', 'middle', 'theory'),
    ('Как оценить состояние сервера при первом подключении?', 'diagnostics', 'middle', 'case'),
    ('Как восстановить доступ, если потерян пароль root?', 'recovery', 'middle', 'case'),
    ('Виртуальная машина упала, а файловая система повреждена. Каков порядок восстановления?', 'recovery', 'senior', 'case'),
    ('Откуда top и htop получают сведения о системе?', 'diagnostics', 'middle', 'theory'),
    ('Что означает Steal Time в top?', 'processes', 'middle', 'theory'),
    ('Для чего нужны strace и lsof?', 'diagnostics', 'middle', 'theory'),
    ('Как проанализировать нагрузку на диск через iostat?', 'diagnostics', 'middle', 'command'),
    ('Для чего нужна утилита sar?', 'diagnostics', 'middle', 'theory'),
    ('Как применять grep, awk, sed и cut при диагностике?', 'text-processing', 'middle', 'command'),
    ('Какие режимы работы есть в Vim?', 'editors', 'junior', 'theory'),
    ('Как оформить команду или сценарий как службу systemd?', 'systemd', 'middle', 'command'),
    ('На Nginx высокий Load Average, но процессор не нагружен и памяти достаточно. Куда смотреть?', 'diagnostics', 'senior', 'case'),
    ('Что такое виртуализация, гипервизор и KVM?', 'virtualization', 'middle', 'theory')
), package AS (
  SELECT packages.package_id
  FROM catalog.packages AS packages
  WHERE packages.slug = 'professor-it-linux-foundation'
  LIMIT 1
)
INSERT INTO content.professorit_shared_cards (
  package_id,
  stable_card_key,
  front_text,
  back_text,
  card_type,
  subject_slug,
  topic_slug,
  difficulty,
  question_type,
  publication_status,
  interview_source
)
SELECT
  package.package_id,
  'interview-linux-' || md5(lower(regexp_replace(source.question, '\s+', ' ', 'g'))),
  source.question,
  'Ответ готовится и проверяется автором курса.',
  'basic',
  'linux',
  source.topic_slug,
  source.difficulty,
  source.question_type,
  'draft',
  'Перечень вопросов Professor IT от 25.08.2026'
FROM source
CROSS JOIN package
WHERE NOT EXISTS (
  SELECT 1
  FROM content.professorit_shared_cards AS existing
  WHERE lower(regexp_replace(existing.front_text, '\s+', ' ', 'g')) = lower(regexp_replace(source.question, '\s+', ' ', 'g'))
)
ON CONFLICT (package_id, stable_card_key) DO NOTHING;
