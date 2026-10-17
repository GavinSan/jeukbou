// 示範模式：唔使登入、唔駁 Firebase，用假資料睇介面（/demo、/demo/t/0）。
// 喺示範入嘅數只會留喺呢部機，重新載入就冇。
import { useMemo, useState } from 'react';
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

export default function Demo() {
  const path = usePath();
  const rules = useMemo(() => withRules({}), []);
  const [events, setEvents] = useState<Record<string, StoredEvent[]>>(seed);
  const [dice, setDice] = useState<Record<string, Dice>>({});
  const [seatOverride, setSeatOverride] = useState<Record<string, string[]>>({});
  const [extraNames, setExtraNames] = useState<Record<string, string>>({});
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
        <RulesEditor initial={{}} canEdit scopeNote="示範：改完唔會儲存。" onSave={async () => undefined} />
      </main>
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
      candidates={[{ id: 'kit', name: 'Kit' }, { id: 'jo', name: 'Jo' }]}
    />
  );
}
