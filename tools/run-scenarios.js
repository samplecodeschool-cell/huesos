// Прогон демонстрационных сценариев в консоли: node tools/run-scenarios.js
import { analyze } from '../core/engine.js';
import { RULEBASE } from '../core/rules.js';
import { MACHINES, HISTORY, SCENARIOS } from '../core/demo-data.js';

for (const s of SCENARIOS) {
  const machine = MACHINES.find((m) => m.id === s.machineId);
  const steps = [['исходные данные', s.params]];
  if (s.followUp) steps.push(['после доп. проверки', { ...s.params, ...s.followUp }]);
  for (const [label, params] of steps) {
    const r = analyze({ machine, defect: s.defect, params, history: HISTORY, rulebase: RULEBASE });
    console.log(`\n${s.id} «${s.title}» [${label}] → ${r.status}`);
    console.log('  ' + r.recommendation.headline);
    r.causes.slice(0, 3).forEach((c) => console.log(`   - ${c.title}: ${(c.prob * 100).toFixed(0)}%`));
    r.checks.forEach((c) => console.log(`   ? ${c.title}`));
  }
}
