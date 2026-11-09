import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultSettings = {
  persona: '你是 Peko，用户的桌面搭档。默认用中文，温暖、俏皮、自然。日常可以开玩笑；工作时简洁直接，准确汇报操作、结果和故障。尊重用户的独处时间，不编造共同经历。',
  memoryEnabled: true, proactive: true, dnd: false, idleMinutes: 60,
  activeStart: 9, activeEnd: 22, maxDailyGreetings: 2,
  petX: 1100, petY: 400, petWidth: 400, petHeight: 600, petScale: 1,
  petMonitor: '', petDpi: 96,
  topmost: true, clickThrough: false, avatar: 'yumi', provider: '', model: '',
};

function fingerprint(text) { return text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, ''); }
export function containsSecret(text) {
  return /(?:sk-|gh[pousr]_|github_pat_|AKIA)[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:api[_ -]?key|password|密码|密钥|token|secret)\s*[:=：]\s*\S+/i.test(text);
}

export class State {
  constructor(file) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, fingerprint TEXT UNIQUE NOT NULL, source_session TEXT NOT NULL, source_seq INTEGER NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS forgotten (fingerprint TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (session TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(session,seq));
      CREATE TABLE IF NOT EXISTS memory_cursors (session TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS greetings (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS avatar_states (session TEXT PRIMARY KEY, state TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  settings() { return { ...defaultSettings, ...JSON.parse(this.db.prepare('SELECT value FROM settings WHERE id=1').get()?.value ?? '{}') }; }
  updateSettings(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置必须为对象');
    const next = this.settings();
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in defaultSettings)) throw new Error(`未知设置 ${key}`);
      if (typeof value !== typeof defaultSettings[key]) throw new Error(`设置 ${key} 类型错误`);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`设置 ${key} 数值错误`);
      next[key] = value;
    }
    if (next.persona.length > 12000 || next.idleMinutes < 1 || next.idleMinutes > 1440 || next.activeStart < 0 || next.activeEnd > 24 || next.activeStart >= next.activeEnd || next.maxDailyGreetings < 0 || next.maxDailyGreetings > 20 || next.petScale < 0.1 || next.petScale > 4) throw new Error('设置超出范围');
    if(!['yumi','bingtang','ellen'].includes(next.avatar))throw new Error('角色必须选自固定目录');
    this.db.prepare('INSERT OR REPLACE INTO settings VALUES(1,?)').run(JSON.stringify(next)); return next;
  }
  memories() { return this.db.prepare('SELECT id,text,source_session AS sourceSession,source_seq AS sourceSeq,created FROM memories ORDER BY created').all(); }
  addMemory(text, sourceSession, sourceSeq, manual = false) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000 || containsSecret(text)) throw new Error('记忆为空、过长或包含凭据');
    if (!manual && !this.settings().memoryEnabled) return null;
    const fp = fingerprint(text);
    if (!manual && this.db.prepare('SELECT 1 FROM forgotten WHERE fingerprint=?').get(fp)) return null;
    const id = randomUUID();
    this.db.prepare('INSERT OR IGNORE INTO memories VALUES(?,?,?,?,?,?)').run(id, text.trim(), fp, sourceSession, sourceSeq, new Date().toISOString());
    return this.memories().find(m => fingerprint(m.text) === fp) ?? null;
  }
  deleteMemory(id) {
    const row = this.db.prepare('SELECT fingerprint FROM memories WHERE id=?').get(id);
    if (!row) return false;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT OR IGNORE INTO forgotten VALUES(?)').run(row.fingerprint);
      this.db.prepare('DELETE FROM memories WHERE id=?').run(id); this.db.exec('COMMIT'); return true;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  editMemory(id, text) {
    const old = this.memories().find(m => m.id === id); if (!old) throw new Error('记忆不存在');
    if (typeof text !== 'string' || !text.trim() || text.length > 1000 || containsSecret(text)) throw new Error('记忆内容无效');
    this.db.prepare('INSERT OR IGNORE INTO forgotten VALUES(?)').run(fingerprint(old.text));
    this.db.prepare('UPDATE memories SET text=?,fingerprint=? WHERE id=?').run(text.trim(), fingerprint(text), id);
    return this.memories();
  }
  clearMemories() {
    for (const m of this.memories()) this.deleteMemory(m.id);
    for (const row of this.db.prepare("SELECT session,MAX(seq) AS seq FROM messages WHERE role='user' GROUP BY session").all()) this.advanceMemory(row.session,row.seq);
    return [];
  }
  rememberSession(id, cwd, title = '新对话') {
    this.db.prepare('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?)').run(id, title.slice(0,60), cwd, new Date().toISOString());
    this.db.prepare('UPDATE sessions SET cwd=? WHERE id=?').run(cwd,id);
  }
  sessions() { return this.db.prepare('SELECT * FROM sessions ORDER BY created DESC').all(); }
  avatarState(session) { return JSON.parse(this.db.prepare('SELECT state FROM avatar_states WHERE session=?').get(session)?.state??'{}'); }
  setAvatarState(session,state) { this.db.prepare('INSERT OR REPLACE INTO avatar_states VALUES(?,?)').run(session,JSON.stringify(state)); }
  message(session, seq, role, text) {
    this.db.prepare('INSERT OR IGNORE INTO messages VALUES(?,?,?,?)').run(session,seq,role,text);
    if(role==='user') this.db.prepare("UPDATE sessions SET title=? WHERE id=? AND title='新对话'").run(text.slice(0,40),session);
    if(role==='user'&&!this.settings().memoryEnabled)this.advanceMemory(session,seq);
  }
  messages(session) { return this.db.prepare('SELECT seq,role,text FROM messages WHERE session=? ORDER BY seq').all(session); }
  pendingUserFacts(session) {
    const cursor = this.db.prepare('SELECT seq FROM memory_cursors WHERE session=?').get(session)?.seq ?? -1;
    return this.db.prepare("SELECT seq,text FROM messages WHERE session=? AND role='user' AND seq>? ORDER BY seq").all(session,cursor).filter(r=>!containsSecret(r.text));
  }
  advanceMemory(session, seq) { this.db.prepare('INSERT INTO memory_cursors VALUES(?,?) ON CONFLICT(session) DO UPDATE SET seq=MAX(seq,excluded.seq)').run(session,seq); }
  greetingAllowed(now, idleMinutes) {
    const s=this.settings(), hour=now.getHours(), day=`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
    if(!s.proactive||s.dnd||hour<s.activeStart||hour>=s.activeEnd||idleMinutes<s.idleMinutes) return false;
    const n=this.db.prepare('SELECT count FROM greetings WHERE day=?').get(day)?.count??0;
    return n<s.maxDailyGreetings;
  }
  markGreeting(now) {
    const day=`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
    this.db.prepare('INSERT INTO greetings VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(day);
  }
  close() { this.db.close(); }
}
