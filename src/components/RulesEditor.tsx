// 家規設定：局主先改得，其他人睇
import { useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_RULES, withRules } from '../engine/rules.ts';
import type { Rules } from '../engine/rules.ts';
import type { RulesPatch } from '../lib/data.ts';
import { message } from '../ui.tsx';

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled: boolean }) {
  return <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

function Num({ value, onChange, label, disabled, step = 1 }: { value: number; onChange: (v: number) => void; label: string; disabled: boolean; step?: number }) {
  return (
    <input
      className="mini-num"
      type="number"
      inputMode="numeric"
      min={0}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
    />
  );
}

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="rule-row">
      <span className="grow">{title}{note && <small>{note}</small>}</span>
      {children}
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
      <p className="muted small">{scopeNote}{canEdit ? '' : ' 淨係局主改得。'}</p>

      <h2>自動計</h2>
      <div className="list">
        <Row title="底" note={r.base > 0 ? `每個輸家每鋪俾 ${r.base}` : '唔計底'}>
          {r.base > 0 && <Num value={r.base} onChange={(v) => set({ base: v })} label="底幾多番" disabled={d} />}
          <Switch on={r.base > 0} onChange={(v) => set({ base: v ? DEFAULT_RULES.base : 0 })} label="自動計底" disabled={d} />
        </Row>
        <Row title="莊番" note="2n + 1：連莊 n 次，莊食糊或者莊出銃先加">
          <Switch on={r.dealer.enabled} onChange={(v) => set({ dealer: { ...r.dealer, enabled: v } })} label="自動計莊" disabled={d} />
        </Row>
        <Row title="雙響 / 三響" note={multiOn ? `每個食糊加 ${r.multiWinBonus.double} / ${r.multiWinBonus.triple}` : '唔加'}>
          {multiOn && <Num value={r.multiWinBonus.double} onChange={(v) => set({ multiWinBonus: { ...r.multiWinBonus, double: v } })} label="雙響加幾多" disabled={d} />}
          {multiOn && <Num value={r.multiWinBonus.triple} onChange={(v) => set({ multiWinBonus: { ...r.multiWinBonus, triple: v } })} label="三響加幾多" disabled={d} />}
          <Switch on={multiOn} onChange={(v) => set({ multiWinBonus: v ? DEFAULT_RULES.multiWinBonus : { double: 0, triple: 0 } })} label="自動計雙響" disabled={d} />
        </Row>
        <Row title="反雙響 / 反三響" note={r.reverse.enabled ? `響完出銃嗰個自摸，有份食佢嘅加 ${r.reverse.double} / ${r.reverse.triple}` : '唔計'}>
          {r.reverse.enabled && <Num value={r.reverse.double} onChange={(v) => set({ reverse: { ...r.reverse, double: v } })} label="反雙響加幾多" disabled={d} />}
          {r.reverse.enabled && <Num value={r.reverse.triple} onChange={(v) => set({ reverse: { ...r.reverse, triple: v } })} label="反三響加幾多" disabled={d} />}
          <Switch on={r.reverse.enabled} onChange={(v) => set({ reverse: { ...r.reverse, enabled: v } })} label="反雙響" disabled={d} />
        </Row>
        <Row title="詐糊" note="俾每家">
          <Num value={r.falseWinPenalty} onChange={(v) => set({ falseWinPenalty: v })} label="詐糊俾每家幾多" disabled={d} />
        </Row>
      </div>

      <h2>拉 / 劈</h2>
      <div className="list">
        <Row title="拉 / 劈" note="連續食同一個人：今鋪俾新鋪 + 未找 ÷ 2">
          <Switch on={r.la.enabled} onChange={(v) => set({ la: { ...r.la, enabled: v } })} label="拉劈" disabled={d} />
        </Row>
        {r.la.enabled && (
          <Row title="幾多拉可以找數" note={`第 ${r.la.settleEvery}、${r.la.settleEvery * 2}、${r.la.settleEvery * 3}… 拉輸家揀`}>
            <Num value={r.la.settleEvery} onChange={(v) => set({ la: { ...r.la, settleEvery: Math.max(1, v) } })} label="幾多拉可以找數" disabled={d} />
          </Row>
        )}
        <Row title="÷ 2 有小數">
          <div className="seg" role="group" aria-label="小數點處理">
            {([['ceil', '進位'], ['round', '四捨五入'], ['none', '保留']] as const).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={r.rounding === v} disabled={d} onClick={() => set({ rounding: v })}>{t}</button>
            ))}
          </div>
        </Row>
      </div>

      <h2>抽水</h2>
      <div className="list">
        <Row title="抽水" note={r.water.enabled ? `每 ${r.water.per} 抽 ${r.water.take}，花同槓唔抽` : '唔抽'}>
          <Switch on={r.water.enabled} onChange={(v) => set({ water: { ...r.water, enabled: v } })} label="抽水" disabled={d} />
        </Row>
        {r.water.enabled && (
          <>
            <Row title="每幾多番抽一次">
              <Num value={r.water.per} onChange={(v) => set({ water: { ...r.water, per: Math.max(1, v) } })} label="每幾多番" disabled={d} />
            </Row>
            <Row title="每次抽幾多">
              <Num value={r.water.take} onChange={(v) => set({ water: { ...r.water, take: v } })} label="抽幾多" disabled={d} />
            </Row>
            <Row title="幾時抽">
              <div className="seg" role="group" aria-label="幾時抽水">
                {([['settle', '真正收錢'], ['win', '食糊']] as const).map(([v, t]) => (
                  <button key={v} type="button" aria-pressed={r.water.timing === v} disabled={d} onClick={() => set({ water: { ...r.water, timing: v } })}>{t}</button>
                ))}
              </div>
            </Row>
          </>
        )}
      </div>

      <h2>其他</h2>
      <div className="list">
        <Row title="流局冧莊" note={r.dealer.drawKeepsDealer ? '流局莊家連莊' : '流局過莊'}>
          <Switch on={r.dealer.drawKeepsDealer} onChange={(v) => set({ dealer: { ...r.dealer, drawKeepsDealer: v } })} label="流局冧莊" disabled={d} />
        </Row>
        <Row title="打幾多圈完場" note="0 = 唔限，撳完場先完">
          <Num value={r.rounds} onChange={(v) => set({ rounds: v })} label="幾多圈" disabled={d} />
        </Row>
        <Row title="換人嗰陣邊啲拉找數">
          <div className="seg" role="group" aria-label="換人找數">
            {([['player', '走嗰個'], ['table', '成張枱']] as const).map(([v, t]) => (
              <button key={v} type="button" aria-pressed={r.swapSettle === v} disabled={d} onClick={() => set({ swapSettle: v })}>{t}</button>
            ))}
          </div>
        </Row>
      </div>

      {canEdit && <button type="button" className="btn big" disabled={busy} onClick={save}>儲存家規</button>}
      {note && <p className={note === '已儲存' ? 'ok' : 'error'} role="status">{note}</p>}
    </div>
  );
}
