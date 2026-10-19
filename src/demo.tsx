// 示範模式：唔使登入、唔駁 Firebase，用假資料睇介面（/demo、/demo/t/0）。
// 喺示範入嘅數只會留喺呢部機，重新載入就冇。
import { useEffect, useMemo, useState } from 'react';
import type { TableEvent } from './engine/table.ts';
import { withRules } from './engine/rules.ts';
import type { Dice, StoredEvent, TableDoc, LogEvent } from './lib/data.ts';
import { computeTable } from './lib/score.ts';
import type { Computed } from './lib/score.ts';
import { match, usePath } from './lib/router.tsx';
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
import type { JoinMode, JoinRequest } from './lib/data.ts';
import { AddSheet, GroupRowView, ProfileHead, SearchAdd } from './pages/Home.tsx';
import { Invite, JoinRequestsView } from './pages/GroupPage.tsx';
import { NoticeBar } from './components/Watch.tsx';
import { pushNotice } from './lib/notify.ts';
import { toAvatar } from './lib/avatar.ts';

const TABLES: TableDoc[] = [
  { id: 't0', name: '第 1 枱', order: 0, seats: ['gavin', 'athena', 'ivan', 'viola'], names: { gavin: 'Gavin', athena: 'Athena', ivan: 'Ivan', viola: 'Viola' } },
  { id: 't1', name: '第 2 枱', order: 1, seats: ['janice', 'sang', 'clau', 'af'], names: { janice: 'Janice', sang: 'Sang', clau: 'Clau', af: 'AF' } },
  { id: 't2', name: '第 3 枱', order: 2, seats: ['robin', 'tat', 'nat', 'ts'], names: { robin: 'Robin', tat: 'Tat', nat: 'Nat', ts: 'TS' } },
  { id: 't3', name: '第 4 枱', order: 3, seats: ['mandy', 'ben', 'wing', 'kitty'], names: { mandy: 'Mandy', ben: 'Ben', wing: 'Wing', kitty: 'Kitty' } },
];

const eat = (w: string, fan: number, l: string): TableEvent => ({ type: 'win', winners: [{ player: w, fan }], loser: l });
const self = (w: string, fan: number): TableEvent => ({ type: 'win', winners: [{ player: w, fan }], loser: null });

const SCRIPT: Record<string, TableEvent[]> = {
  t0: [eat('athena', 8, 'viola'), self('ivan', 10), { type: 'special', player: 'ivan', label: '暗槓', amount: 5, direction: 'collect' }, eat('gavin', 15, 'ivan'), eat('gavin', 20, 'ivan')],
  t1: [self('janice', 12), eat('sang', 30, 'clau'), { type: 'draw' }],
  t2: [eat('tat', 6, 'nat'), eat('robin', 10, 'tat'), self('tat', 15), eat('ts', 40, 'robin')],
};

function seed(): Record<string, StoredEvent[]> {
  const out: Record<string, StoredEvent[]> = {};
  const start = Date.now() - 95 * 60 * 1000;
  for (const [t, evs] of Object.entries(SCRIPT)) {
    out[t] = evs.map((event, i) => ({ seq: i + 1, by: 'demo', event, at: start + (i + 1) * (17 + t.length) * 60 * 1000 + Number(t.slice(1)) * 4 * 60 * 1000 }));
  }
  return out;
}

// 示範：過去 7 日，每日一至兩場，每場 8 個人
const DEMO_NAMES: Record<string, string> = {
  gavin: 'Gavin', athena: 'Athena', ivan: 'Ivan', viola: 'Viola', janice: 'Janice', sang: 'Sang', clau: 'Clau', af: 'AF', robin: 'Robin', tat: 'Tat',
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
      out.push({ id: `h${d}-${g}`, name: `${date.getMonth() + 1}月${date.getDate()}日 ${g ? '宵夜局' : '屋企局'}`, at, totals });
    }
  }
  return out;
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
  const [extraNames, setExtraNames] = useState<Record<string, string>>({});
  const [settleCfg, setSettleCfg] = useState<SettleConfig>({ ...DEFAULT_SETTLE, waterTo: 'gavin' });
  const [expenses, setExpenses] = useState<ExpenseDoc[]>([
    { id: 'e1', kind: 'expense', label: '晚餐', payer: 'gavin', amount: 186.4, sharedBy: ['gavin', 'athena', 'ivan', 'viola', 'janice', 'sang', 'clau', 'af'], by: 'demo', at: null },
  ]);
  const [pairs, setPairs] = useState<PairDoc[]>([{ id: 'p1', a: 'robin', b: 'tat', by: 'robin', accepted: ['robin'] }]);
  // 首頁示範
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [joinMode, setJoinModeDemo] = useState<JoinMode>('approve');
  const [reqs, setReqs] = useState<JoinRequest[]>([
    { uid: 'kit', name: 'Kit', photoURL: null, inviteCode: 'x', at: null },
    { uid: 'mandy', name: 'Mandy', photoURL: null, inviteCode: 'x', at: null },
  ]);
  useEffect(() => {
    if (path !== '/demo/home') return;
    pushNotice({ g: 'demo', at: Date.now(), title: '「不打不相識」番數表已更新', body: 'Gavin：清一色 30 → 40、新增 天胡 200', url: '/demo/rules' });
  }, [path]);
  const tables = useMemo(
    () => TABLES.map((t) => ({ ...t, seats: seatOverride[t.id] ?? t.seats, names: { ...t.names, ...extraNames }, dice: dice[t.id] ?? null })),
    [seatOverride, extraNames, dice],
  );

  const computed = useMemo(() => {
    const out: Record<string, Computed | null> = {};
    for (const t of tables) out[t.id] = computeTable(t, events[t.id] ?? [], rules);
    return out;
  }, [events, rules, tables]);

  if (path === '/demo/rules') {
    return (
      <main className="page">
        <TopBar back="/demo" title="家規" />
        <HouseRules
          fans={<FanTableView table={DEFAULT_FAN_TABLE} canEdit onSave={async () => undefined} />}
          scoring={<RulesEditor initial={{}} canEdit scopeNote="示範：修改不會儲存。" onSave={async () => undefined} />}
          settle={<SettleConfigForm cfg={settleCfg} canEdit accounts={[{ id: 'gavin', name: 'Gavin' }, { id: 'athena', name: 'Athena' }, { id: 'ivan', name: 'Ivan' }]} busy={false} error="" onSave={(c) => setSettleCfg(c)} />}
        />
      </main>
    );
  }

  if (path === '/demo/home') {
    const groups = [{ id: 'a', name: '不打不相識', fresh: true, asks: 2 }, { id: 'b', name: '星期五雀局', fresh: false, asks: 0 }, { id: 'c', name: '公司麻雀會', fresh: false, asks: 0 }];
    const shown = groups.filter((g) => !q.trim() || g.name.includes(q.trim()));
    const g = { id: 'demo', name: '不打不相識', ownerId: 'gavin', inviteCode: 'abc', joinCode: 'K7PQ2M', joinMode };
    return (
      <main className="page home">
        <TopBar />
        <section className="panel">
          <ProfileHead name="Gavin" email="gavin@example.com" photo={photo} busy={false} onPick={async (f) => { if (f) setPhoto(await toAvatar(f)); }} right={<button type="button" className="btn plain">改名</button>} />
        </section>
        <a className="listrow list resume" href="/demo"><span className="resume-dot" aria-hidden="true" /><span className="grow">繼續：10月18日 屋企局</span></a>
        <section className="stack">
          <SearchAdd q={q} onQ={setQ} onAdd={() => setAdding(true)} />
          <div className="list">
            <div className="listrow pending-row"><span className="grow">麻雀研究社<small className="muted">　等待局主批准</small></span><button type="button" className="textbtn">取消申請</button></div>
          </div>
          <div className="list">
            {shown.map((x) => <GroupRowView key={x.id} href="/demo" name={x.name} fresh={x.fresh} badge={x.asks ? <span className="tag ask">{x.asks} 人申請</span> : null} />)}
          </div>
        </section>
        <JoinRequestsView reqs={reqs} onApprove={async (r) => setReqs((l) => l.filter((x) => x.uid !== r.uid))} onReject={async (r) => setReqs((l) => l.filter((x) => x.uid !== r.uid))} />
        <section className="panel">
          <h2>成員（8）</h2>
          <Invite g={g} canManage onMode={setJoinModeDemo} />
        </section>
        {adding && <AddSheet user={null} photo={null} groups={[]} onClose={() => setAdding(false)} />}
        <NoticeBar />
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
        me="gavin"
        onSaveConfig={async (c) => setSettleCfg(c)}
        settingsHref="/demo/rules#settle"
        onAddExpense={async (e) => setExpenses((l) => [...l, { ...e, id: `e${l.length + 1}-${Date.now()}`, by: 'gavin', at: Date.now() }])}
        onDeleteExpense={async (id) => setExpenses((l) => l.filter((x) => x.id !== id))}
        onProposePair={async (a, b) => setPairs((l) => [...l, { id: `p${Date.now()}`, a, b, by: 'gavin', accepted: [a, b].filter((x) => x === 'gavin') }])}
        onAcceptPair={async (id) => setPairs((l) => l.map((x) => (x.id === id ? { ...x, accepted: [...x.accepted, 'gavin'] } : x)))}
        onDeletePair={async (id) => setPairs((l) => l.filter((x) => x.id !== id))}
      />
    );
  }

  const m = match('/demo/t/:i', path);
  const table = m ? tables[Number(m.i)] : undefined;

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
        back="/demo"
        subtitle="示範"
        candidates={[{ id: 'kit', name: 'Kit' }, { id: 'mandy', name: 'Mandy' }]}
        onPush={push}
        onSwap={async (out, incoming) => {
          setExtraNames((n) => ({ ...n, [incoming.id]: incoming.name }));
          await push({ type: 'swap', out, in: incoming.id });
          return 'done';
        }}
        onReseat={async (s) => setSeatOverride((o) => ({ ...o, [table.id]: s }))}
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
    />
  );
}
