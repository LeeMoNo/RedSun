
## RedSUn
API=https://redsun-dict.wasai-test.workers.dev

### 部署
wrangler deploy

### Cloudflare D1 指令更新操作说明

当前数据库名是 redsun-dict，本地目录是：

cd /Users/leewasai/Cloudflare
日常操作前先确认登录账号和远端连接：

wrangler whoami
wrangler d1 execute redsun-dict --remote --command "SELECT COUNT(*) FROM entries;"
schema.sql 主要用于新建数据库或彻底重建表。如果远端 D1 已经有数据，后续不要随便整份重新导入 schema.sql，否则容易遇到旧表结构不变、重复插入、或者需要删表重建的问题。日常更新应该用 ALTER TABLE、UPDATE、单独的 SQL 文件，或者正式一点用 D1 migrations。

修改某个词条时，推荐先查出目标：

wrangler d1 execute redsun-dict --remote --command "SELECT id, word, reading, tone, zh_cn, verified, ai_generated FROM entries WHERE word = '食べる';"
确认后再更新。比如人工校正 tone：

wrangler d1 execute redsun-dict --remote --command "UPDATE entries SET tone = '2', verified = 1, ai_generated = 0 WHERE word = '食べる' AND reading = 'たべる';"
如果知道 id，用 id 更新更稳：

wrangler d1 execute redsun-dict --remote --command "UPDATE entries SET tone = '2', verified = 1, ai_generated = 0 WHERE id = 1;"
修改中文释义、例句也一样：

wrangler d1 execute redsun-dict --remote --command "UPDATE entries SET zh_cn = '吃；食用', example_zh = '每天都在吃蔬菜。', verified = 1, ai_generated = 0 WHERE id = 1;"
如果要批量校正，建议新建一个小 SQL 文件，比如 fix-tones.sql：

UPDATE entries SET tone = '2', verified = 1, ai_generated = 0 WHERE word = '食べる' AND reading = 'たべる';
UPDATE entries SET tone = '0', verified = 1, ai_generated = 0 WHERE word = '勉強' AND reading = 'べんきょう';
UPDATE entries SET tone = '0', verified = 1, ai_generated = 0 WHERE word = '電車' AND reading = 'でんしゃ';
然后执行：

wrangler d1 execute redsun-dict --remote --file ./fix-tones.sql
如果以后要增加一个新字段，比如 source，对已有 D1 表使用：

wrangler d1 execute redsun-dict --remote --command "ALTER TABLE entries ADD COLUMN source TEXT;"
注意：已有表增加字段时，不建议直接加 NOT NULL 且没有默认值，因为旧数据没有这个字段值。比较稳的流程是先加可空字段，填充数据，再决定是否重建表加严格约束。

如果你的 Worker/API 返回 JSON，要让 JSON 里出现 tone，数据库有字段还不够，查询语句也要包含它：

SELECT id, word, reading, tone, zh_cn, pos, jlpt, frequency, example_jp, example_zh, verified, ai_generated
FROM entries;
如果代码里手动组装 JSON，也要把 tone: row.tone 加进去。

如果以后要批量新增词条，建议单独创建 insert-words.sql，不要把几千条塞进一条巨大的 INSERT。D1 可能报：

statement too long: SQLITE_TOOBIG
稳妥写法是每 50 条左右拆成一条 INSERT：

INSERT INTO entries (word,reading,tone,zh_cn,pos,jlpt,frequency,example_jp,example_zh) VALUES
('単語','たんご','0','单词','名词','N5',1,'単語を覚えます。','记单词。'),
('例文','れいぶん','0','例句','名词','N4',2,'例文を読みます。','读例句。');
执行：

wrangler d1 execute redsun-dict --remote --file ./insert-words.sql
如果确认要彻底重建远端数据，比如用新的 schema.sql 覆盖全部内容，才使用删表导入：

wrangler d1 execute redsun-dict --remote --command "DROP TABLE IF EXISTS entries;"
wrangler d1 execute redsun-dict --remote --file ./schema.sql
执行后验证：

wrangler d1 execute redsun-dict --remote --command "SELECT COUNT(*) FROM entries;"
wrangler d1 execute redsun-dict --remote --command "SELECT COUNT(*) FROM entries WHERE tone IS NULL OR tone = '';"
wrangler d1 execute redsun-dict --remote --command "SELECT id, word, reading, tone, zh_cn FROM entries LIMIT 10;"
重要操作前可以先导出备份：

wrangler d1 export redsun-dict --remote --output=./backup-redsun-dict.sql --skip-confirmation
更正式的长期做法是使用 D1 migrations：每次结构变化创建一个 migration 文件，里面只写本次变化，然后 apply 到远端。

wrangler d1 migrations create redsun-dict add_new_field
wrangler d1 migrations list redsun-dict --remote
wrangler d1 migrations apply redsun-dict --remote
简单记忆：
schema.sql 用于初始化或重建；ALTER TABLE 用于改表结构；UPDATE 用于人工校正；INSERT 文件用于批量新增；migrations 用于长期可追踪的正式升级。

参考的是 Cloudflare 官方 D1 文档：Wrangler D1 commands、D1 migrations、D1 import/export。

后续若是出现混乱，直接删除重新导入库。

运营人员在哪里校正
最省事：直接用 Cloudflare 自带的 D1 控制台。
打开 dash.cloudflare.com → Storage & databases → D1 → redsun-dict → Console，直接在网页里输 SQL 修改，不需要任何额外工具。

password=RS260520

