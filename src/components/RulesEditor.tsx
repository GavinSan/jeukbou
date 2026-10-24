// 家規設定：局主先改得，其他人睇
import { useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_RULES, withRules } from '../engine/rules.ts';
import type { Rules } from '../engine/rules.ts';
import type { RulesPatch } from '../lib/data.ts';
import { NumInput, message } from '../ui.tsx';

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled: boolean }) {
  return <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

function Num({ value, onChange, label, disabled, min = 0 }: { value: number; onChange: (v: number) => void; label: string; disabled: boolean; min?: number }) {
  return <NumInput value={value} onChange={onChange} label={label} disabled={disabled} min={min} max={9999} />;
}

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="rule-row">
      <span className="grow">{title}{note && <small>{note}</small>}</span>
      <span className="rule-ctrl">{children}</span>
    </div>
  );
}

export default function RulesEditor({ initial, canEdit, onSave, scopeNote }: {
  initial: RulesPatch | undefined;
  canEdit: boolean;
  onSave: (rules: RulesPatch) => Promise<void>;
  scopeNote: string;
}) {
  const [r, setR] = useState<Rules>(() => withRules(initial ?? {}));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const d = !canEdit;
  const set = (patch: Partial<Rules>) => { setR((x) => ({ ...x, ...patch })); setNote(''); };

  async function save() {
    setBusy(true);
    setNote('');
    try {
      await onSave(r);
      setNote('已儲存');
    } catch (err) {
      setNote(message(err));
    } finally {
      setBusy(false);
    }
  }

  const multiOn = r.multiWinBonus.double > 0 || r.multiWinBonus.triple > 0;

  return (
    <div className="stack">
      <p className="muted small">{scopeNote}{canEdit ? '' : ' 只有局主可修改。'}</p>

      <h2>自動計</h2>
      <div className="list">
        <Row title="底" note={r.base > 0 ? `每個輸家每鋪付 ${r.base}` : '不計底'}>
          {r.base > 0 && <Num value={r.base} onChange={(v) => set({ base: v })} label="底" disabled={d} min={1} />}
          <Switch on={r.base > 0} onChange={(v) => set({ base: v ? DEFAULT_RULES.base : 0 })} label="自動計底" disabled={d} />
        </Row>
        <Row title="莊番" note="2n + 1（n = 連莊次數），只在莊家食糊或出銃時加">
          <Switch on={r.dealer.enabled} onChange={(v) => set({ dealer: { ...r.dealer, enabled: v } })} label="自動計莊" disabled={d} />
        </Row>
        <Row title="雙響 / 三響" note={multiOn ? `每位贏家加 ${r.multiWinBonus.double} / ${r.multiWinBonus.triple}` : '不加'}>
          {multiOn && <Num value={r.multiWinBonus.double} onChange={(v) => set({ multiWinBonus: { ...r.multiWinBonus, double: v } })} label="雙響加番" disabled={d} />}
          {multiOn && <Num value={r.multiWinBonus.triple} onChange={(v) => set({ multiWinBonus: { ...r.multiWinBonus, triple: v } })} label="三響加番" disabled={d} />}
          <Switch on={multiOn} onChange={(v) => set({ multiWinBonus: v ? DEFAULT_RULES.multiWinBonus : { double: 0, triple: 0 } })} label="自動計雙響" disabled={d} />
        </Row>
        <Row title="反雙響 / 反三響" note={r.reverse.enabled ? `出銃者其後自摸，之前的贏家加付 ${r.reverse.double} / ${r.reverse.triple}` : '不計'}>
          {r.reverse.enabled && <Num value={r.reverse.double} onChange={(v) => set({ reverse: { ...r.reverse, double: v } })} label="反雙響加番" disabled={d} />}
          {r.reverse.enabled && <Num value={r.reverse.triple} onChange={(v) => set({ reverse: { ...r.reverse, triple: v } })} label="反三響加番" disabled={d} />}
          <Switch on={r.reverse.enabled} onChange={(v) => set({ reverse: { ...r.reverse, enabled: v } })} label="反雙響" disabled={d} />
        </Row>
        <Row title="詐糊" note="付每家">
          <Num value={r.falseWinPenalty} onChange={(v) => set({ falseWinPenalty: v })} label="詐糊付每家" disabled={d} />
        </Row>
      </div>

      <h2>拉 / 劈</h2>
      <div className="list">
        <Row title="拉 / 劈" note="連續食同一人：付今鋪 + 未找 ÷ 2">
          <Switch on={r.la.enabled} onChange={(v) => set({ la: { ...r.la, enabled: v } })} label="拉劈" disabled={d} />
        </Row>
        {r.la.enabled && (
          <Row title="每幾拉可找數" note={`第 ${r.la.settleEvery}、${r.la.settleEvery * 2}、${r.la.settleEvery * 3}… 拉由輸家決定`}>
            <Num value={r.la.settleEvery} onChange={(v) => set({ la: { ...r.la, settleEvery: Math.max(1, v) } })} label="每幾拉可找數" disabled={d} min={1} />
          </Row>
        )}
        <Row title="÷ 2 的小數">
          <div className="seg" role="group" aria-label="小數點處理">
            {([['ceil', '進位'], ['round', '四捨五入'], ['none', '保留']] as const).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={r.rounding === v} disabled={d} onClick={() => set({ rounding: v })}>{t}</button>
            ))}
          </div>
        </Row>
      </div>

      <h2>抽水</h2>
      <div className="list">
        <Row title="抽水" note={r.water.enabled ? `每 ${r.water.per} 抽 ${r.water.take}，特別事項不抽` : '不抽'}>
          <Switch on={r.water.enabled} onChange={(v) => set({ water: { ...r.water, enabled: v } })} label="抽水" disabled={d} />
        </Row>
        {r.water.enabled && (
          <>
            <Row title="每幾番抽一次">
              <Num value={r.water.per} onChange={(v) => set({ water: { ...r.water, per: Math.max(1, v) } })} label="每幾番" disabled={d} min={1} />
            </Row>
            <Row title="每次抽">
              <Num value={r.water.take} onChange={(v) => set({ water: { ...r.water, take: v } })} label="每次抽" disabled={d} />
            </Row>
            <Row title="抽水時間">
              <div className="seg" role="group" aria-label="抽水時間">
                {([['settle', '找數時'], ['win', '食糊時']] as const).map(([v, t]) => (
                  <button key={v} type="button" aria-pressed={r.water.timing === v} disabled={d} onClick={() => set({ water: { ...r.water, timing: v } })}>{t}</button>
                ))}
              </div>
            </Row>
          </>
        )}
      </div>

      <h2>其他</h2>
      <div className="list">
        <Row title="流局連莊" note={r.dealer.drawKeepsDealer ? '流局莊家連莊' : '流局過莊'}>
          <Switch on={r.dealer.drawKeepsDealer} onChange={(v) => set({ dealer: { ...r.dealer, drawKeepsDealer: v } })} label="流局連莊" disabled={d} />
        </Row>
        <Row title="圈數" note="0 = 不限，按完場才結束">
          <Num value={r.rounds} onChange={(v) => set({ rounds: v })} label="圈數" disabled={d} />
        </Row>
        <Row title="幾時可以執位" note={r.reseat === 'any' ? '隨時（莊照舊喺嗰個位）' : r.reseat === 'round' ? '每打完一圈' : '打完預定圈數先換'}>
          <div className="seg" role="group" aria-label="幾時可以執位">
            {([['any', '隨時'], ['round', '每圈'], ['four', '打完圈']] as const).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={(r.reseat ?? 'round') === v} disabled={d} onClick={() => set({ reseat: v })}>{t}</button>
            ))}
          </div>
        </Row>
        <Row title="換人時結算">
          <div className="seg" role="group" aria-label="換人找數">
            {([['player', '離開者'], ['table', '全枱']] as const).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={r.swapSettle === v} disabled={d} onClick={() => set({ swapSettle: v })}>{t}</button>
            ))}
          </div>
        </Row>
      </div>

      <h2>特別事項（每家）</h2>
      <div className="list">
        {([
          ['flower', '一台花（收）'], ['grass', '一台草（收）'], ['kong', '暗槓（收）'], ['kongForgot', '暗槓唔記得開（罰）'],
          ['heaven', '天槓（收）'], ['heavenForgot', '天槓唔記得開（罰）'], ['triple', '圍骰（收）'], ['dice123', '骰開一二三（付）'], ['pong', '叫碰唔碰（付）'],
        ] as const).map(([k, t]) => (
          <Row key={k} title={t}>
            <Num value={r.specials[k]} onChange={(v) => set({ specials: { ...r.specials, [k]: v } })} label={t} disabled={d} />
          </Row>
        ))}
      </div>

      {canEdit && <button type="button" className="btn big" disabled={busy} onClick={save}>儲存家規</button>}
      {note && <p className={note === '已儲存' ? 'ok' : 'error'} role="status">{note}</p>}
    </div>
  );
}
