// 示範模式：唔使登入、唔駁 Firebase，用假資料睇介面（/demo、/demo/t/0）。
// 喺示範入嘅數只會留喺呢部機，重新載入就冇。
import { useEffect, useMemo, useState } from 'react';
import type { TableEvent } from './engine/table.ts';
import { withRules } from './engine/rules.ts';
import type { Dice, Draw, StoredEvent, TableDoc, LogEvent } from './lib/data.ts';
import { computeTable, emptyPlay } from './lib/score.ts';
import type { Computed } from './lib/score.ts';
import { Link, match, usePath } from './lib/router.tsx';
import { SkinPicker } from './components/Settings.tsx';
import SessionScreen from './components/SessionScreen.tsx';
import TableScreen from './components/TableScreen.tsx';
import RulesEditor from './components/RulesEditor.tsx';
import { TopBar } from './ui.tsx';
import BoardView from './components/BoardView.tsx';
import LegacySession from './components/LegacySession.tsx';
import type { SessionResult } from './lib/history.ts';
import SettleScreen, { SettleConfigForm } from './components/SettleScreen.tsx';
import HouseRules from './components/HouseRules.tsx';
import { FanTableView } from './components/FanTable.tsx';
import { DEFAULT_SETTLE } from './lib/data.ts';
import type { ExpenseDoc, PairDoc, SettleConfig } from './lib/data.ts';
import { sessionSummary } from './lib/totals.ts';
import { DEFAULT_FAN_TABLE } from './lib/fanTable.ts';
import type { JoinMode, JoinRequest, Meetup } from './lib/data.ts';
import { MeetupsView } from './components/Meetups.tsx';
import { AddSheet, GroupRowView, SearchAdd } from './pages/Groups.tsx';
import { DashboardView, ResumeRow } from './pages/Home.tsx';
import { RankView } from './pages/RankPage.tsx';
import { MyPayView } from './pages/MyPayPage.tsx';
import { AdminView } from './pages/AdminPage.tsx';
import { LiveTv, tvTablesOf } from './pages/LivePage.tsx';
import type { TvTable } from './pages/LivePage.tsx';
import { WaterBox } from './pages/GroupPage.tsx';
import { Sheet } from './ui.tsx';
import { LiveCardView } from './components/LiveHome.tsx';
import type { ChatMsg } from './lib/live.ts';
import type { PayItem } from './lib/pay.ts';
import { Invite, JoinRequestsView, MemberList, memberStatsOf } from './pages/GroupPage.tsx';
import type { MemberStat } from './pages/GroupPage.tsx';
import { PlayerSheet } from './components/BoardView.tsx';
import { mySessions, pointsFor } from './lib/stats.ts';
import type { GroupResults } from './lib/stats.ts';
import TeamsEditor from './components/Teams.tsx';
import { NoticeBar } from './components/Watch.tsx';
import { pushNotice } from './lib/notify.ts';
import { InstallSteps } from './components/InstallGuide.tsx';

const TABLES: TableDoc[] = [
  { id: 't0', name: '第 1 枱', order: 0, seats: ['gavin', 'athena', 'ivan', 'viola'], names: { gavin: 'Gavin', athena: 'Athena', ivan: 'Ivan', viola: 'Viola' } },
  { id: 't1', name: '第 2 枱', order: 1, seats: ['janice', 'sang', 'clau', 'af'], names: { janice: 'Janice', sang: 'Sang', clau: 'Clau', af: 'AF' } },
  { id: 't2', name: '第 3 枱', order: 2, seats: ['robin', 'tat', 'nat', 'ts'], names: { robin: 'Robin', tat: 'Tat', nat: 'Nat', ts: 'TS' } },
  { id: 't3', name: '第 4 枱', order: 3, seats: ['mandy', 'ben', 'wing', 'kitty'], names: { mandy: 'Mandy', ben: 'Ben', wing: 'Wing', kitty: 'Kitty' } },
  { id: 't4', name: '第 5 枱', order: 4, seats: ['pat', 'sam', 'lok', 'yan'], names: { pat: 'Pat Chan', sam: 'Samantha Wong', lok: 'Lok', yan: 'Yan' } },
];
// 測試用嘅枱（唔喺示範大局入面，淨係 /demo/t/5、/demo/t/6 用）：夠三拉、雙響同特別事項
const TEST_TABLES: TableDoc[] = [
  { id: 't5', name: '測試：夠拉', order: 5, seats: ['gavin', 'kit', 'jo', 'vincent'], names: { gavin: 'Gavin', kit: 'Kit', jo: 'Jo', vincent: 'Vincent' } },
  { id: 't6', name: '測試：雙響', order: 6, seats: ['gavin', 'kit', 'jo', 'vincent'], names: { gavin: 'Gavin', kit: 'Kit', jo: 'Jo', vincent: 'Vincent' } },
  // 同時拉三家：三條拉一齊夠數，睇三個「找唔找」提示一齊出
  { id: 't7', name: '測試：拉 3 家 3 次', order: 7, seats: ['gavin', 'kit', 'jo', 'vincent'], names: { gavin: 'Gavin', kit: 'Kit', jo: 'Jo', vincent: 'Vincent' } },
  // 第 3 拉三家都揀咗「不找」，再拉到第 6 拉
  { id: 't8', name: '測試：拉 3 家 6 次', order: 8, seats: ['gavin', 'kit', 'jo', 'vincent'], names: { gavin: 'Gavin', kit: 'Kit', jo: 'Jo', vincent: 'Vincent' }, declined: ['gavin>kit#3', 'gavin>jo#3', 'gavin>vincent#3'] },
];

// 第 5 枱：打完四圈（每鋪下家食，莊逐個過），用嚟睇「打完圈數」
const FULL_ROUNDS: TableEvent[] = (() => {
  const seats = ['pat', 'sam', 'lok', 'yan'];
  return Array.from({ length: 16 }, (_, i) => ({ type: 'win', winners: [{ player: seats[(i + 1) % 4], fan: 5 + (i % 3) * 5 }], loser: seats[(i + 2) % 4] }) as TableEvent);
})();

const eat = (w: string, fan: number, l: string): TableEvent => ({ type: 'win', winners: [{ player: w, fan }], loser: l });
const self = (w: string, fan: number): TableEvent => ({ type: 'win', winners: [{ player: w, fan }], loser: null });

const SCRIPT: Record<string, TableEvent[]> = {
  t0: [eat('athena', 8, 'viola'), self('ivan', 10), { type: 'special', player: 'ivan', label: '暗槓', amount: 5, direction: 'collect' }, eat('gavin', 15, 'ivan'), eat('gavin', 20, 'ivan')],
  t1: [self('janice', 12), eat('sang', 30, 'clau'), { type: 'draw' }],
  t2: [eat('tat', 6, 'nat'), eat('robin', 10, 'tat'), self('tat', 15), eat('ts', 40, 'robin')],
  t4: FULL_ROUNDS,
  t5: [eat('gavin', 10, 'kit'), eat('gavin', 8, 'kit'), eat('gavin', 12, 'kit')],
  t6: [
    { type: 'win', winners: [{ player: 'gavin', fan: 10 }, { player: 'jo', fan: 6 }], loser: 'kit' } as TableEvent,
    { type: 'special', player: 'vincent', label: '一台花', amount: 10, direction: 'collect' },
    { type: 'falseWin', player: 'kit' },
    self('jo', 20),
  ],
  // 自摸 = 同時拉三家
  t7: [self('gavin', 5), self('gavin', 8), self('gavin', 6)],
  t8: [self('gavin', 5), self('gavin', 8), self('gavin', 6), self('gavin', 3), self('gavin', 10), self('gavin', 4)],
};

// 示範番數表：清一色改咗、加咗天胡（通知撳入去會自動打開有改嘅分類）
const DEMO_FAN_TABLE = (() => {
  const t = structuredClone(DEFAULT_FAN_TABLE);
  const sec = t.sections.find((x) => x.items.some((it) => it.name === '清一色'));
  if (sec) {
    sec.items = sec.items.map((it) => (it.name === '清一色' ? { ...it, value: '100' } : it));
    sec.items.push({ name: '天胡', value: '200' });
  }
  return t;
})();
const DEMO_FAN_LOG = { at: Date.now() - 3600000, by: 'gavin', byName: 'Gavin', changes: ['清一色 80 → 100', '新增 天胡 200'] };

function seed(): Record<string, StoredEvent[]> {
  const out: Record<string, StoredEvent[]> = {};
  const start = Date.now() - 95 * 60 * 1000;
  for (const [t, evs] of Object.entries(SCRIPT)) {
    out[t] = evs.map((event, i) => ({ seq: i + 1, by: 'demo', event, at: t === 't4' ? start + (i + 1) * 5 * 60 * 1000 : start + (i + 1) * (17 + t.length) * 60 * 1000 + Number(t.slice(1)) * 4 * 60 * 1000 }));
  }
  return out;
}

// 示範：過去 7 日，每日一至兩場，每場 8 個人
const DEMO_NAMES: Record<string, string> = {
  gavin: 'Gavin', athena: 'Athena', ivan: 'Ivan', viola: 'Viola', janice: 'Janice', sang: 'Sang', clau: 'Clau', af: 'AF', robin: 'Robin', tat: 'Tat', kit: 'Kit',
};
const DEMO_HISTORY: SessionResult[] = (() => {
  let seed = 20261018;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ids = Object.keys(DEMO_NAMES);
  const out: SessionResult[] = [];
  const today = new Date();
  today.setHours(20, 0, 0, 0);
  for (let d = 7; d >= 0; d--) {
    const games = d % 3 === 0 ? 2 : 1;
    for (let g = 0; g < games; g++) {
      const at = today.getTime() - d * 86400000 + g * 3 * 3600000;
      const players = [...ids].sort(() => rnd() - 0.5).slice(0, 8);
      const totals: Record<string, number> = {};
      let sum = 0;
      players.slice(0, -1).forEach((p) => { const v = Math.round((rnd() - 0.48) * 120); totals[p] = v; sum += v; });
      totals[players[players.length - 1]] = -sum;
      const date = new Date(at);
      out.push({ id: `h${d}-${g}`, name: `${date.getMonth() + 1}月${date.getDate()}日 ${g ? '宵夜局' : '屋企局'}`, at, totals, play: { ...emptyPlay(), rounds: Object.fromEntries(players.map((p) => [p, g ? 2 : 4])) } });
    }
  }
  return out;
})();

/** 示範：電腦派晒剩低嘅牌 */
function autoFill(d: Draw): Draw {
  const used = new Set(Object.values(d.picks));
  const left = d.players.map((p) => p.id).filter((id) => !used.has(id));
  const free = d.tiles.map((_, i) => i).filter((i) => !d.picks[String(i)]).sort(() => Math.random() - 0.5);
  const picks = { ...d.picks };
  left.forEach((id, k) => { if (free[k] !== undefined) picks[String(free[k])] = id; });
  return { ...d, picks, status: 'done' };
}

const DEMO_TEAMS = [
  { id: 'd1', members: ['gavin', 'athena'], accepted: ['gavin', 'athena'], by: 'gavin' },
  { id: 'd2', members: ['robin', 'kit'], accepted: ['robin', 'kit'], by: 'robin' },
];

// 首頁示範：四個月、兩個牌友圈
const DEMO_GROUPS: GroupResults[] = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ids = Object.keys(DEMO_NAMES);
  const make = (gid: string, name: string, count: number, gap: number): GroupResults => {
    const sessions: SessionResult[] = [];
    const start = Date.now() - count * gap * 86400000;
    for (let i = 0; i < count; i++) {
      const at = start + i * gap * 86400000 + 20 * 3600000;
      const players = ['gavin', ...ids.filter((x) => x !== 'gavin').sort(() => rnd() - 0.5).slice(0, 7)];
      const totals: Record<string, number> = {};
      let sum = 0;
      players.slice(1).forEach((p) => { const v = Math.round((rnd() - 0.5) * (rnd() > 0.85 ? 500 : 180)); totals[p] = v; sum += v; });
      totals.gavin = Math.round((rnd() - 0.4) * 260);
      sum += totals.gavin;
      const last = players[players.length - 1];
      totals[last] -= sum;
      const d = new Date(at);
      // 示範數據：每人食糊、自摸、出銃、最大一鋪；每圈 35–55 分鐘
      const play = emptyPlay();
      play.hands = 24 + Math.floor(rnd() * 10);
      for (const p of players) {
        play.wins[p] = Math.floor(rnd() * 7);
        play.selfDraws[p] = Math.floor(rnd() * 3);
        play.dealIns[p] = Math.floor(rnd() * 6);
        play.best[p] = 10 + Math.floor(rnd() * 70);
        play.rounds![p] = 4;
        play.pulls![p] = Math.floor(rnd() * 4);
      }
      play.biggest = { player: players[Math.floor(rnd() * players.length)], fan: 60 + Math.floor(rnd() * 80) };
      play.maxStreak = { player: players[Math.floor(rnd() * players.length)], n: 1 + Math.floor(rnd() * 4) };
      play.roundMs = [0, 1, 2, 3].map(() => (35 + rnd() * 20) * 60000);
      play.playMs = play.roundMs.reduce((a, b) => a + b, 0);
      sessions.push({ id: `${gid}${i}`, name: `${d.getMonth() + 1}月${d.getDate()}日 屋企局`, at, totals, play });
    }
    return { gid, name, sessions, names: DEMO_NAMES };
  };
  return [make('a', '不打不相識', 34, 3), make('b', '星期五雀局', 9, 9)];
})();

// 主頁示範：另外兩個牌友圈都打緊（轉台用）
const OTHER_LIVE: Record<string, { name: string; icon: string; session: string; tables: TvTable[]; chat: ChatMsg[] }> = (() => {
  const P = (id: string, name: string, v: number, wind: string) => ({ id, name, v, wind });
  return {
    b: {
      name: '星期五雀局', icon: '🎲', session: '10月22日 星期五局',
      tables: [{ id: 'b1', name: '第 1 枱', round: '南圈西位 第 7 鋪', dealer: 'tony', players: [P('tony', 'Tony', 86, '東'), P('kingsang', 'King Sang', -12, '南'), P('janice', 'Janice', -30, '西'), P('ivan', 'Ivan', -44, '北')], last: 'Tony 自摸 每家 13 番' }],
      chat: [{ id: 'b1', by: 'tony', name: 'Tony', text: '今晚手風順 😎', at: Date.now() - 240000 }],
    },
    c: {
      name: '公司麻雀會', icon: '🏢', session: '10月22日 午飯局',
      tables: [
        { id: 'c1', name: '第 1 枱', round: '東圈北位 第 4 鋪', dealer: 'may', players: [P('may', 'May', 25, '北'), P('ken', 'Ken', 10, '東'), P('joe', 'Joe', -5, '南'), P('ann', 'Ann', -30, '西')], last: 'May 食 Ann（20 番）' },
        { id: 'c2', name: '第 2 枱', round: '東圈南位 第 2 鋪', dealer: 'leo', players: [P('leo', 'Leo', 16, '南'), P('sue', 'Sue', 0, '西'), P('bob', 'Bob', -8, '北'), P('kay', 'Kay', -8, '東')], last: 'Leo 自摸 每家 8 番' },
      ],
      chat: [{ id: 'c1', by: 'ken', name: 'Ken', text: '仲有十分鐘就要返工 😂', at: Date.now() - 120000 }],
    },
  };
})();

export default function Demo() {
  const path = usePath();
  const [noWater, setNoWater] = useState(false);
  const [closed, setClosed] = useState<{ by: string; at: number } | null>(null);
  const [waterTo, setWaterTo] = useState('gavin');
  const rules = useMemo(() => {
    const r = withRules({});
    return noWater ? { ...r, water: { ...r.water, enabled: false } } : r;
  }, [noWater]);
  const [events, setEvents] = useState<Record<string, StoredEvent[]>>(seed);
  const [dice, setDice] = useState<Record<string, Dice>>({});
  const [seatOverride, setSeatOverride] = useState<Record<string, string[]>>({});
  // 一齊執位多咗組人（例如 24 人 5 張枱）：開新枱
  const [addedTables, setAddedTables] = useState<TableDoc[]>([]);
  const [extraNames, setExtraNames] = useState<Record<string, string>>({});
  const [settleCfg, setSettleCfg] = useState<SettleConfig>({ ...DEFAULT_SETTLE, waterTo: 'gavin' });
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([
    { id: 'e1', kind: 'expense', label: '晚餐', payer: 'gavin', amount: 186.4, sharedBy: ['gavin', 'athena', 'ivan', 'viola', 'janice', 'sang', 'clau', 'af'], by: 'demo', at: null },
    { id: 'e2', kind: 'expense', label: '飲品', payer: 'guest-vincent', amount: 23.92, sharedBy: [], all: true, note: '奶茶', names: { 'guest-vincent': 'Vincent' }, by: 'demo', at: null },
  ]);
  const [demoDraw, setDemoDraw] = useState<Draw | null>(null);
  const [chats, setChats] = useState<Record<string, ChatMsg[]>>(() => ({
    a: [
      { id: '1', by: 'athena', name: 'Athena', text: 'Gavin 今晚好旺喎 🔥', at: Date.now() - 600000 },
      { id: '2', by: 'ivan', name: 'Ivan', text: '下一鋪一定到我', at: Date.now() - 300000 },
    ],
    b: OTHER_LIVE.b.chat,
    c: OTHER_LIVE.c.chat,
  }));
  const [demoMusic, setDemoMusic] = useState<Record<string, string>>({});
  const [groupSheet, setGroupSheet] = useState(false);
  const [demoPaid, setDemoPaid] = useState<Record<string, { by: string; at: number }>>({});
  const [people, setPeople] = useState<{ id: string; name: string }[]>([{ id: 'guest-vincent', name: 'Vincent' }]);
  const [pairs, setPairs] = useState<PairDoc[]>([{ id: 'p1', a: 'robin', b: 'tat', by: 'robin', accepted: ['robin'] }]);
  // 首頁示範
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [manageDemo, setManageDemo] = useState(false);
  const [pickDemo, setPickDemo] = useState<string | null>(null);
  const [joinMode, setJoinModeDemo] = useState<JoinMode>('approve');
  const [meets, setMeets] = useState<Meetup[]>(() => {
    const at = (days: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.getTime(); };
    const names = { gavin: 'Gavin', athena: 'Athena', ivan: 'Ivan', viola: 'Viola', kit: 'Kit' };
    return [
      { id: 'm1', by: 'athena', byName: 'Athena', at: at(2, 20), place: 'Athena 屋企', note: '打 8 圈，食完飯先', going: ['athena', 'ivan', 'viola'], maybe: ['kit'], no: [], names, createdAt: Date.now() - 3600000, tables: 1 },
      { id: 'm2', by: 'gavin', byName: 'Gavin', at: at(9, 19), place: '', note: '長週末開兩枱？', going: ['gavin', 'athena', 'ivan', 'viola', 'kit'], maybe: [], no: [], names, createdAt: Date.now() - 7200000, tables: 2 },
    ];
  });
  const [reqs, setReqs] = useState<JoinRequest[]>([
    { uid: 'kit', name: 'Kit', photoURL: null, inviteCode: 'x', at: null },
    { uid: 'mandy', name: 'Mandy', photoURL: null, inviteCode: 'x', at: null },
  ]);
  useEffect(() => {
    if (path !== '/demo/home') return;
    pushNotice({ g: 'demo', at: Date.now(), title: '「不打不相識」番數表已更新', body: 'Gavin：清一色 80 → 100、新增 天胡 200', url: '/demo/rules#fans' });
  }, [path]);
  const tables = useMemo(
    () => [...TABLES, ...addedTables].map((t) => ({ ...t, seats: seatOverride[t.id] ?? t.seats, names: { ...t.names, ...extraNames }, dice: dice[t.id] ?? null })),
    [seatOverride, extraNames, dice, addedTables],
  );
  const testTables = useMemo(
    () => TEST_TABLES.map((t) => ({ ...t, seats: seatOverride[t.id] ?? t.seats, names: { ...t.names, ...extraNames }, dice: dice[t.id] ?? null })),
    [seatOverride, extraNames, dice],
  );

  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of [...tables, ...testTables]) out[t.id] = computeTable(t, events[t.id] ?? [], rules);
    return out;
  }, [events, rules, tables, testTables]);

  if (path === '/demo/cases') {
    const C: [string, string, string][] = [
      ['/demo/home', '主頁', '戰績、3 個 Live 牌友圈、日曆、加主畫面提示、補資料提示'],
      ['/demo/groups', '牌友圈列表', '搜尋、公開牌友圈、加入碼'],
      ['/demo/group', '牌友圈頁', '約局（三缺一、兩枱、局主唔去由下一個接手）、成員、權限、邀請'],
      ['/demo', '大局', '5 張枱、一齊執位、加枱、電視直播'],
      ['/demo/t/0', '枱：一般', '入數、番數表、特別事項（返回）、換人、撤回、紀錄分段'],
      ['/demo/t/1', '枱：有流局', '流局（唔使確認）、拉同枱面'],
      ['/demo/t/2', '枱：大番數', '40 番、找數'],
      ['/demo/t/3', '枱：未開始', '掉位、擲骰'],
      ['/demo/t/4', '枱：打完四圈', '再打四圈、快圈、完場'],
      ['/demo/t/5', '枱：夠三拉', '決定找唔找數'],
      ['/demo/t/6', '枱：雙響、特別事項、詐糊、自摸', '紀錄寫實際食幾多番'],
      ['/demo/t/7', '枱：拉 3 家 3 次', '三個「找唔找」提示一齊出'],
      ['/demo/t/8', '枱：拉 3 家 6 次', '第 3 拉唔找，第 6 拉再問三家'],
      ['/demo/t/0?view=1', '枱：唔喺呢張枱', '只可以睇，入唔到數、擲唔到骰'],
      ['/demo/settle', '埋數', '開支、Group、轉賬、已轉'],
      ['/demo/pay', '找數', '我要俾、我要收、Interac email'],
      ['/demo/board', '龍虎榜', '走勢（所有人、highlight 自己）、排行表、數據'],
      ['/demo/rank', '段位', '段位進度、成就'],
      ['/demo/live', '電視直播', '大字分數、直播室、音樂（♫ 貼連結撳「播」）、轉台（3 個 Live）'],
      ['/demo/rules', '家規', '番數表、抽水、拉'],
      ['/demo/install', '加主畫面教學', 'iPhone Safari、其他瀏覽器、Android'],
      ['/demo/skins', '風格', '10 款風格'],
      ['/demo/admin', '超級管理員', '用戶、牌友圈'],
      ['/demo/legacy', '舊紀錄', '匯入嘅舊數'],
    ];
    return (
      <main className="page">
        <TopBar title="示範：測試清單" />
        <p className="muted small">全部係假資料，撳嚟撳去都唔會改到真嘅數。重新載入就會還原。右上角「退出示範」返去真 app。</p>
        <div className="list">
          {C.map(([href, t, d]) => (
            <Link key={href} to={href} className="listrow">
              <span className="grow"><b>{t}</b><small className="muted" style={{ display: 'block' }}>{d}</small></span>
              <span className="chev" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </main>
    );
  }
  if (path === '/demo/rules') {
    return (
      <main className="page">
        <TopBar back="/demo" title="家規" />
        <HouseRules
          fans={<FanTableView table={DEMO_FAN_TABLE} log={DEMO_FAN_LOG} canEdit onSave={async () => undefined} />}
          scoring={<RulesEditor initial={{}} canEdit scopeNote="示範：修改不會儲存。" onSave={async () => undefined} />}
          settle={<>
            <SettleConfigForm cfg={settleCfg} canEdit accounts={[{ id: 'gavin', name: 'Gavin' }, { id: 'athena', name: 'Athena' }, { id: 'ivan', name: 'Ivan' }]} busy={false} error="" onSave={(c) => setSettleCfg(c)} />
            <TeamsEditor teams={DEMO_TEAMS} people={Object.entries(DEMO_NAMES).map(([id, name]) => ({ id, name }))} me="gavin" canDeleteAny onCreate={async () => undefined} onAccept={async () => undefined} onDelete={async () => undefined} />
          </>}
        />
      </main>
    );
  }

  const liveM = path === '/demo/live' ? { c: 'a' } : match('/demo/live/:c', path);
  if (liveM) {
    const c = OTHER_LIVE[liveM.c] ? liveM.c : 'a';
    const tv = c === 'a' ? tvTablesOf(tables, computed) : OTHER_LIVE[c].tables;
    const acc = new Map<string, { id: string; name: string; v: number }>();
    for (const t of tv) for (const pl of t.players) { const r = acc.get(pl.id) ?? { id: pl.id, name: pl.name, v: 0 }; r.v += pl.v; acc.set(pl.id, r); }
    const channels = [{ key: 'a', label: '不打不相識・10月18日 屋企局', href: '/demo/live' }, ...Object.entries(OTHER_LIVE).map(([k, x]) => ({ key: k, label: `${x.name}・${x.session}`, href: `/demo/live/${k}` }))];
    return (
      <LiveTv
        key={c}
        groupName={c === 'a' ? '不打不相識' : OTHER_LIVE[c].name}
        icon={c === 'a' ? '🀄' : OTHER_LIVE[c].icon}
        sessionName={c === 'a' ? '10月18日 屋企局' : OTHER_LIVE[c].session}
        tables={tv}
        ranking={[...acc.values()].sort((a, b) => b.v - a.v)}
        chat={chats[c] ?? []}
        music={demoMusic[c] || undefined}
        me="gavin"
        backHref="/demo/home"
        channels={channels}
        current={c}
        onSend={async (t) => setChats((m) => ({ ...m, [c]: [...(m[c] ?? []), { id: `${c}${Date.now()}`, by: 'gavin', name: 'Gavin', text: t, at: Date.now() }] }))}
        onMusic={async (u) => setDemoMusic((m) => ({ ...m, [c]: u.trim() }))}
      />
    );
  }

  if (path === '/demo/home') {
    return (
      <>
        <DashboardView
          name="Gavin"
          photo={null}
          joined="2026年9月加入"
          groupCount={2}
          mine={mySessions(DEMO_GROUPS, 'gavin')}
          loading={false}
          resume={<ResumeRow href="/demo" name="10月18日 屋企局" />}
          live={(() => {
            const tv = tvTablesOf(tables, computed).slice(0, 3);
            const card = (t: TvTable) => ({ id: t.id, name: t.name, round: t.round, players: [...t.players].sort((a, b) => b.v - a.v) });
            return (
              <>
                <LiveCardView groupName="不打不相識" icon="🀄" sessionName="10月18日 屋企局" href="/demo" tvHref="/demo/live" me="gavin" tables={tv.map(card)} />
                {Object.entries(OTHER_LIVE).map(([k, x]) => (
                  <LiveCardView key={k} groupName={x.name} icon={x.icon} sessionName={x.session} href={`/demo/live/${k}`} tvHref={`/demo/live/${k}`} me="gavin" tables={x.tables.map(card)} />
                ))}
              </>
            );
          })()}
          sessionHref={() => '/demo'}
          rankHref="/demo/rank"
        />
        <NoticeBar />
      </>
    );
  }

  if (path === '/demo/pay') {
    const mk = (sid: string, sname: string, from: string, to: string, amount: number, paid = false): PayItem => ({
      gid: 'a', gname: '不打不相識', sid, sname, at: Date.now() - Number(sid.slice(1)) * 86400000, from, to, amount, key: `${from}>${to}`, paid,
      dir: from.split(' + ').includes('gavin') ? 'pay' : to.split(' + ').includes('gavin') ? 'get' : 'other', currency: 'CAD',
    });
    const items = [
      mk('s1', '10月19日 屋企局', 'gavin + athena', 'tony', 28.83),
      mk('s1', '10月19日 屋企局', 'janice', 'gavin', 7),
      mk('s3', '10月16日 屋企局', 'gavin', 'kingsang', 16.66),
      mk('s5', '10月14日 屋企局', 'ivan', 'gavin', 12.5),
      mk('s9', '10月10日 屋企局', 'gavin', 'tony', 9.33, true),
    ];
    return (
      <MyPayView
        me="gavin"
        items={items}
        legacy={[{ gid: 'a', gname: '不打不相識', sid: 'l1', sname: '9月19日 舊紀錄', at: Date.now() - 30 * 86400000, fan: -67, cash: -11.17 }]}
        names={{ gavin: 'Gavin', athena: 'Athena', tony: 'Tony Tsui', janice: 'Janice Yeung', kingsang: 'King Sang Li', ivan: 'Ivan' }}
        emails={{ tony: 'tony.tsui@example.com', kingsang: 'ksl@example.com' }}
        loading={false}
        onToggle={() => undefined}
        onRemind={async () => { await new Promise((r) => setTimeout(r, 600)); return '✓ 已催（示範）'; }}
      />
    );
  }

  if (path === '/demo/admin') {
    const day = 86400000;
    const now = Date.now();
    const people = [['gavin', 'Gavin', 'gavin@example.com'], ['athena', 'Athena', 'athena@example.com'], ['tony', 'Tony Tsui', 'tony@example.com'], ['janice', 'Janice Yeung', ''], ['kingsang', 'King Sang Li', 'ksl@example.com'], ['ivan', 'Ivan', 'ivan@example.com']];
    const groups = [
      { id: 'a', name: '不打不相識', ownerId: 'gavin', joinMode: 'approve', joinCode: 'k7pq2m', members: people.map(([uid, name]) => ({ uid, name })),
        sessions: [0, 3, 5, 9, 30].map((d, i) => ({ id: `s${i}`, name: `${new Date(now - d * day).getMonth() + 1}月${new Date(now - d * day).getDate()}日 屋企局`, at: now - d * day, closed: i > 0, legacy: i === 4 })) },
      { id: 'b', name: '星期五雀局', ownerId: 'tony', joinMode: 'auto', joinCode: 'zz81qa', members: people.slice(1, 5).map(([uid, name]) => ({ uid, name })),
        sessions: [2, 12].map((d, i) => ({ id: `t${i}`, name: `星期五 ${i + 1}`, at: now - d * day, closed: true, legacy: false })) },
    ];
    const users = people.map(([uid, name, email]) => ({ uid, name, email, payEmail: email, groups: uid === 'gavin' ? ['a'] : uid === 'ivan' ? ['a'] : ['a', 'b'], updatedAt: now - day, firstName: uid === 'tony' ? 'Tony' : '', lastName: uid === 'tony' ? 'Tsui' : '', birthday: uid === 'tony' ? '10-24' : '' }));
    return <AdminView me="gavin" groups={groups} users={users} error="" onRefresh={() => undefined} />;
  }

  if (path === '/demo/install') {
    return (
      <main className="page narrow">
        <TopBar back="/demo/home" title="加到主畫面（示範）" />
        <section className="panel stack"><h2>iPhone Safari</h2><InstallSteps p="ios-safari" inviteLink="/join/demo/abc" /></section>
        <section className="panel stack"><h2>iPhone 其他瀏覽器</h2><InstallSteps p="ios-other" /></section>
        <section className="panel stack"><h2>Android</h2><InstallSteps p="android" /></section>
      </main>
    );
  }
  if (path === '/demo/skins') {
    return (
      <main className="page">
        <TopBar back="/demo/home" title="試風格" />
        <p className="muted small">揀一款，之後去其他示範頁睇吓。只係改呢部機，隨時可以喺「設定」轉返。</p>
        <SkinPicker />
        <div className="list">
          {[['/demo/home', '主頁'], ['/demo', '大局'], ['/demo/t/0', '枱'], ['/demo/settle', '埋數'], ['/demo/board', '龍虎榜'], ['/demo/rank', '段位']].map(([href, label]) => (
            <Link key={href} to={href} className="listrow"><span className="grow">{label}</span><span className="chev" aria-hidden="true">›</span></Link>
          ))}
        </div>
      </main>
    );
  }

  if (path === '/demo/rank') {
    return <RankView me="gavin" mine={mySessions(DEMO_GROUPS, 'gavin')} groups={DEMO_GROUPS} loading={false} />;
  }

  if (path === '/demo/groups') {
    const groups = [{ id: 'a', name: '不打不相識', fresh: true, asks: 2 }, { id: 'b', name: '星期五雀局', fresh: false, asks: 0 }, { id: 'c', name: '公司麻雀會', fresh: false, asks: 0 }];
    const shown = groups.filter((g) => !q.trim() || g.name.includes(q.trim()));
    return (
      <main className="page">
        <TopBar title="牌友圈" />
        <section className="stack">
          <SearchAdd q={q} onQ={setQ} onAdd={() => setAdding(true)} />
          <div className="list">
            <div className="listrow pending-row"><span className="grow">麻雀研究社<small className="muted">　等待局主批准</small></span><button type="button" className="textbtn">取消申請</button></div>
          </div>
          <div className="list">
            {shown.map((x) => <GroupRowView key={x.id} href="/demo/group" name={x.name} fresh={x.fresh} badge={x.asks ? <span className="tag ask">{x.asks} 人申請</span> : null} />)}
          </div>
        </section>
        {adding && <AddSheet user={null} photo={null} groups={[]} onClose={() => setAdding(false)} />}
      </main>
    );
  }

  if (path === '/demo/group') {
    const g = { id: 'demo', name: '不打不相識', ownerId: 'gavin', inviteCode: 'abc', joinCode: 'K7PQ2M', joinMode };
    const hist = DEMO_GROUPS[0];
    const members = ['gavin', 'athena', 'ivan', 'viola', 'janice', 'robin', 'kit'].map((uid) => ({ uid, name: DEMO_NAMES[uid] ?? uid, photoURL: null }));
    const stats: Record<string, MemberStat> = memberStatsOf(hist.sessions, (id) => pointsFor(id, hist.sessions));
    return (
      <main className="page">
        <TopBar back="/demo/groups" title={g.name} right={<button type="button" className="iconbtn" aria-label="牌友圈設定" onClick={() => setGroupSheet(true)}>⚙︎</button>} />
        {groupSheet && (
          <Sheet onClose={() => setGroupSheet(false)} label="牌友圈設定">
            <h2>牌友圈設定（示範）</h2>
            <WaterBox rows={[{ id: 'gavin', name: 'Gavin', fan: 264, n: 12 }, { id: 'athena', name: 'Athena', fan: 57, n: 3 }]} pending={9} me="gavin" perUnit={6} />
          </Sheet>
        )}
        <JoinRequestsView reqs={reqs} onApprove={async (r) => setReqs((l) => l.filter((x) => x.uid !== r.uid))} onReject={async (r) => setReqs((l) => l.filter((x) => x.uid !== r.uid))} />
        <MeetupsView
          list={meets}
          me="gavin"
          // 示範：當自己唔係牌友圈局主，睇得到約局局主接手（你改「唔去」，Athena 就變局主可以取消）
          ownerOrAdmin={false}
          onCreate={async (m) => setMeets((l) => [...l, { id: `m${Date.now()}`, by: 'gavin', byName: 'Gavin', ...m, going: ['gavin'], maybe: [], no: [], names: { gavin: 'Gavin' }, createdAt: Date.now() }].sort((a, b) => a.at - b.at))}
          onRsvp={async (id, st) => setMeets((l) => l.map((m) => m.id !== id ? m : {
            ...m,
            going: [...m.going.filter((x) => x !== 'gavin'), ...(st === 'going' ? ['gavin'] : [])],
            maybe: [...m.maybe.filter((x) => x !== 'gavin'), ...(st === 'maybe' ? ['gavin'] : [])],
            no: [...m.no.filter((x) => x !== 'gavin'), ...(st === 'no' ? ['gavin'] : [])],
            names: { ...m.names, gavin: 'Gavin' },
          }))}
          onDelete={async (id) => setMeets((l) => l.filter((m) => m.id !== id))}
        />
        <section className="stack">
          <div className="section-head">
            <h2>成員（{members.length}）</h2>
            <button type="button" className="textbtn" onClick={() => setManageDemo((v) => !v)}>{manageDemo ? '完成' : '管理'}</button>
          </div>
          <MemberList members={members} ownerId="gavin" stats={stats} manage={manageDemo} onPick={setPickDemo} onRemove={() => undefined} />
        </section>
        <section className="panel">
          <h2>邀請牌友</h2>
          <Invite g={g} canManage onMode={setJoinModeDemo} />
        </section>
        {pickDemo && (
          <PlayerSheet id={pickDemo} name={DEMO_NAMES[pickDemo] ?? '玩家'} sessions={hist.sessions.filter((x) => pickDemo in x.totals)} all={hist.sessions.filter((x) => pickDemo in x.totals)} scope={g.name} onClose={() => setPickDemo(null)} />
        )}
      </main>
    );
  }

  if (path === '/demo/legacy') {
    const g = { id: 'demo', name: '不打不相識', ownerId: 'gavin', inviteCode: '', legacyNames: { 'janice': 'JANICE', 'sang-h': 'SANG H.', 'athena-c': 'ATHENA C.', 'tsui-shing': 'TSUI SHING', 'af': 'AF', 'viola': 'VIOLA', 'gavin-s': 'GAVIN S.', 'claudia-c': 'CLAUDIA C.', 'alpine-m': 'ALPINE M.' } };
    const sess = { id: 'l1', name: '1月2日 舊紀錄', createdBy: 'gavin', legacy: { totals: { 'janice': 39, 'sang-h': 267, 'athena-c': -334, 'tsui-shing': 198, 'af': 459, 'viola': 7, 'gavin-s': -111, 'claudia-c': -415, 'alpine-m': -242 }, water: 132, paid: true } };
    const mem = [{ uid: 'gavin', name: 'Gavin', photoURL: null, legacyKey: 'gavin-s' }, { uid: 'athena', name: 'Athena', photoURL: null, legacyKey: 'athena-c' }];
    return <LegacySession group={g} session={sess} members={mem} back="/demo" me="gavin" />;
  }

  if (path === '/demo/board') {
    return (
      <main className="page">
        <TopBar back="/demo" title="龍虎榜" />
        <BoardView sessions={DEMO_HISTORY} names={DEMO_NAMES} me="gavin" />
      </main>
    );
  }

  if (path === '/demo/settle') {
    const sum = sessionSummary(tables, computed);
    return (
      <SettleScreen
        title="10月18日 屋企局"
        back="/demo"
        players={sum.players}
        fan={sum.fan}
        water={sum.water}
        unfinished={sum.unfinished}
        config={{ ...settleCfg, waterTo }}
        canSetWater={!closed}
        waterOptions={sum.players}
        onSetWaterTo={async (id) => setWaterTo(id)}
        closing={{
          closed,
          request: null,
          needed: sum.players.map((x) => x.id),
          isHost: true,
          onClose: async () => setClosed({ by: 'gavin', at: Date.now() }),
          onRequest: async () => undefined,
          onApprove: async () => undefined,
          onCancel: async () => undefined,
        }}
        canEdit
        accounts={sum.players}
        expenses={expenses}
        pairs={pairs}
        teams={DEMO_TEAMS}
        teamsHref="/demo/rules#settle"
        me="gavin"
        onSaveConfig={async (c) => setSettleCfg(c)}
        settingsHref="/demo/rules#settle"
        onAddExpense={async (e) => setExpenses((l) => [...l, { ...e, id: `e${l.length + 1}-${Date.now()}`, by: 'gavin', at: Date.now() }])}
        onDeleteExpense={async (id) => setExpenses((l) => l.filter((x) => x.id !== id))}
        onUpdateExpense={async (id, e) => setExpenses((l) => l.map((x) => (x.id === id ? { ...x, ...e, names: e.names, note: e.note } : x)))}
        onProposePair={async (a, b) => setPairs((l) => [...l, { id: `p${Date.now()}`, a, b, by: 'gavin', accepted: [a, b].filter((x) => x === 'gavin') }])}
        onAcceptPair={async (id) => setPairs((l) => l.map((x) => (x.id === id ? { ...x, accepted: [...x.accepted, 'gavin'] } : x)))}
        onDeletePair={async (id) => setPairs((l) => l.filter((x) => x.id !== id))}
        people={people}
        onAddPerson={async (pl) => setPeople((l) => (l.some((x) => x.id === pl.id) ? l : [...l, pl]))}
        onRemovePerson={async (pl) => setPeople((l) => l.filter((x) => x.id !== pl.id))}
        perTable={tables.map((t) => {
          const c = computed[t.id];
          const fan: Record<string, number> = {};
          if (c) for (const id of Object.keys(c.state.settled)) fan[id] = (c.state.settled[id] ?? 0) + (c.pending[id] ?? 0);
          return { id: t.id, name: t.name, fan };
        })}
        paid={demoPaid}
        onMarkPaid={async (key, on) => setDemoPaid((m) => { const n = { ...m }; if (on) n[key] = { by: 'gavin', at: Date.now() }; else delete n[key]; return n; })}
      />
    );
  }

  const m = match('/demo/t/:i', path);
  const table = m ? [...tables, ...testTables].find((t) => t.id === `t${m.i}`) : undefined;

  if (table) {
    const c = computed[table.id];
    if (!c) return null;
    const push = async (event: LogEvent) => {
      setEvents((prev) => {
        const list = prev[table.id] ?? [];
        return { ...prev, [table.id]: [...list, { seq: list.length + 1, by: 'demo', event, at: Date.now() }] };
      });
    };
    return (
      <TableScreen
        table={table}
        computed={c}
        rules={rules}
        me="gavin"
        cash={{ perUnit: settleCfg.perUnit, currency: settleCfg.currency, rounding: settleCfg.rounding }}
        rulesHref="/demo/rules"
        fanTable={DEFAULT_FAN_TABLE}
        canEnter={!(typeof location !== 'undefined' && new URLSearchParams(location.search).has('view'))}
        back="/demo"
        subtitle="示範"
        candidates={[{ id: 'kit', name: 'Kit' }, { id: 'mandy', name: 'Mandy' }]}
        onPush={push}
        onScan={async () => {
          // 示範：假結果（真嘅要 super admin 喺真牌友圈用）
          await new Promise((r) => setTimeout(r, 1200));
          return {
            tiles: ['一萬', '一萬', '一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬', '九萬', '九萬', '東', '東', '東', '東'],
            flowers: ['春', '梅'],
            patterns: [{ name: '清一色', fan: 80, why: '全部萬子（示範）' }, { name: '正花', option: '', fan: 5, why: '春、梅' }],
            total: 85, confidence: 'medium', notes: '示範結果', used: 3, limit: 40,
          };
        }}
        onSwap={async (out, incoming) => {
          setExtraNames((n) => ({ ...n, [incoming.id]: incoming.name }));
          await push({ type: 'swap', out, in: incoming.id });
          return 'done';
        }}
        onReseat={async (s) => ((events[table.id] ?? []).length ? push({ type: 'reseat', seats: s }) : setSeatOverride((o) => ({ ...o, [table.id]: s })))}
        onDice={async () => {
          const values = [1, 2, 3].map(() => 1 + Math.floor(Math.random() * 6));
          setDice((d) => ({ ...d, [table.id]: { values, by: 'gavin', at: Date.now(), n: (d[table.id]?.n ?? 0) + 1 } }));
        }}
      />
    );
  }

  return (
    <SessionScreen
      title="10月18日 屋企局"
      back="/"
      tables={tables}
      computed={computed}
      tableHref={(t) => `/demo/t/${t.slice(1)}`}
      invite={null}
      rulesHref="/demo/rules"
      settleHref="/demo/settle"
      water={{ on: !noWater, onToggle: async (on) => setNoWater(!on) }}
      candidates={[{ id: 'kit', name: 'Kit' }, { id: 'jo', name: 'Jo' }]}
      me="gavin"
      regroup={{
        draw: demoDraw,
        canForce: true,
        // 未坐低嘅人（包括上次執位減咗嘅）
        candidates: (() => {
          const seated = new Set(tables.flatMap((t) => (computed[t.id] && !computed[t.id]!.state.ended ? computed[t.id]!.state.seats : [])));
          const all = new Map<string, string>([...tables.flatMap((t) => Object.entries(t.names)), ['kit', 'Kit'], ['jo', 'Jo']]);
          return [...all].filter(([id]) => !seated.has(id)).map(([id, name]) => ({ id, name }));
        })(),
        onStart: async (d) => {
          setDemoDraw(d);
          if (d.mode === 'auto') setTimeout(() => setDemoDraw((x) => (x ? autoFill(x) : x)), 1400);
        },
        onApprove: async () => setDemoDraw((x) => (x ? { ...x, status: 'picking' } : x)),
        onPick: async (tile, player) => {
          let r: 'ok' | 'taken' | 'done-already' = 'ok';
          setDemoDraw((x) => {
            if (!x || x.picks[String(tile)]) { r = 'taken'; return x; }
            const picks = { ...x.picks, [String(tile)]: player };
            return { ...x, picks, status: Object.keys(picks).length >= x.tiles.length ? 'done' : 'picking' };
          });
          return r;
        },
        onAuto: async () => setDemoDraw((x) => (x ? autoFill(x) : x)),
        onCancel: async () => setDemoDraw(null),
        onApply: async (plan) => {
          // 示範：新嘅幾組人放返入原本未保留嘅枱（用換人＋換位紀錄）；組多過枱就開新枱，枱多過組就完場
          // （真 app 係舊枱完場、開新枱）
          const kept = new Set(plan.map((p) => p.keep).filter(Boolean) as string[]);
          const target = tables.filter((t) => computed[t.id] && !computed[t.id]!.state.ended && !kept.has(t.id));
          const fresh = plan.filter((p) => !p.keep);
          setExtraNames((n) => ({ ...n, ...Object.assign({}, ...tables.map((t) => t.names)), ...Object.assign({}, ...plan.map((p) => p.names)) }));
          const extra = fresh.slice(target.length).map((p, k) => ({ id: `t${20 + addedTables.length + k}`, name: p.name, order: 20 + addedTables.length + k, seats: p.seats, names: p.names } as TableDoc));
          if (extra.length) setAddedTables((l) => [...l, ...extra]);
          setEvents((prev) => {
            const next = { ...prev };
            target.forEach((t, k) => {
              const p = fresh[k];
              const list = [...(next[t.id] ?? [])];
              const add = (event: LogEvent) => list.push({ seq: list.length + 1, by: 'demo', event, at: Date.now() });
              if (!p) { add({ type: 'end' }); next[t.id] = list; return; }
              const current = computed[t.id]?.state.seats ?? [];
              const out = current.filter((x) => !p.seats.includes(x));
              const inn = p.seats.filter((x) => !current.includes(x));
              out.forEach((o, i) => add({ type: 'swap', out: o, in: inn[i] }));
              add({ type: 'reseat', seats: p.seats });
              next[t.id] = list;
            });
            return next;
          });
          setDemoDraw(null);
        },
      }}
    />
  );
}
