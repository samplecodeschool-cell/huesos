"""Шаблон экономического расчёта (п. 8 ТЗ). Считает эффект и окупаемость по входному JSON.

Использование:  python3 tools/economics.py templates/economics.local.json
Формулы: Eпр = Σ(ΔTi × Ci × Ni);  Eгод = Eпр + Eтруд + Eповтор − OPEX;  Tок = CAPEX / Eгод.
Дополнительно: максимальный CAPEX, при котором окупаемость укладывается в лимит, и пороговое ΔT.
"""
import json
import sys


def calc(cfg):
    rows, e_pr = [], 0.0
    for m in cfg["machines"]:
        need = ("events_per_year", "delta_t_hours_per_event", "downtime_cost_per_hour")
        if any(m.get(k) is None for k in need):
            raise ValueError(f"Не заполнены поля для группы «{m.get('group')}»: {need}")
        hours = m["events_per_year"] * m["delta_t_hours_per_event"]
        effect = hours * m["downtime_cost_per_hour"]
        rows.append((m["group"], hours, effect))
        e_pr += effect
    e_year = e_pr + (cfg.get("labor_effect_per_year") or 0) + (cfg.get("repeat_diagnostics_effect_per_year") or 0) - (cfg.get("opex_per_year") or 0)
    capex = cfg.get("capex")
    payback = capex / e_year if capex is not None and e_year > 0 else None
    limit = cfg.get("max_payback_years", 5)
    return {
        "rows": rows, "E_pr": e_pr, "E_year": e_year, "payback_years": payback,
        "max_capex_for_limit": e_year * limit if e_year > 0 else 0,
        "ok": payback is not None and payback <= limit,
    }


def main(path):
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    r = calc(cfg)
    cur = cfg.get("currency", "")
    for g, h, e in r["rows"]:
        print(f"{g:30s} сэкономлено {h:10.1f} ч/год  эффект {e:14.1f} {cur}")
    print(f"Eпр = {r['E_pr']:.1f}  Eгод = {r['E_year']:.1f} {cur}")
    if r["payback_years"] is None:
        print("Tок: не рассчитан (нет CAPEX или Eгод ≤ 0)")
    else:
        print(f"Tок = {r['payback_years']:.2f} лет — {'укладывается' if r['ok'] else 'НЕ укладывается'} в {cfg.get('max_payback_years', 5)} лет")
    print(f"Максимальный CAPEX для окупаемости в срок: {r['max_capex_for_limit']:.1f} {cur}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "templates/economics.local.json")
