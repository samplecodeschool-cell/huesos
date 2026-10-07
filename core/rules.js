// База правил «если → то». Правила — данные (JSON-совместимые), а не код:
// их можно версионировать, подписывать и обновлять через корпоративный контур
// без пересборки приложения.
//
// Условие: { sym } — симптом отмечен; { p, op, lim | value } — параметр.
//   lim — ссылка на порог профиля ('coolantTemp.warn'); op: > >= < <= == present.
// Правило: all — все условия; any — хотя бы одно (если задано).
// causes — веса гипотез; critical — причина запрета эксплуатации до решения ответственного лица.

export const RULEBASE = {
  version: '0.3.0-demo',
  updatedAt: '2026-10-07',
  author: 'Рабочая группа ТОРО-Ассистент (демо-набор, требует валидации надёжником)',
  rules: [
    // --- ДВС / впуск ---
    { id: 'R-ENG-01', title: 'Потеря мощности + высокое разрежение на впуске',
      all: [{ sym: 'POWER_LOSS' }, { p: 'intakeRestriction', op: '>', lim: 'intakeRestriction.max' }],
      causes: { AIR_FILTER: 1.0 } },
    { id: 'R-ENG-02', title: 'Чёрный дым + высокое разрежение на впуске',
      all: [{ sym: 'BLACK_SMOKE' }, { p: 'intakeRestriction', op: '>', lim: 'intakeRestriction.warn' }],
      causes: { AIR_FILTER: 0.8 } },
    { id: 'R-ENG-03', title: 'Чёрный дым при нормальном впуске',
      all: [{ sym: 'BLACK_SMOKE' }, { p: 'intakeRestriction', op: '<=', lim: 'intakeRestriction.warn' }],
      causes: { INJECTORS: 0.9 } },
    { id: 'R-ENG-04', title: 'Потеря мощности (без уточняющих данных)',
      all: [{ sym: 'POWER_LOSS' }],
      causes: { AIR_FILTER: 0.25, INJECTORS: 0.25, TRACTION_OVERHEAT: 0.15 } },

    // --- Охлаждение ---
    { id: 'R-COOL-01', title: 'Температура ОЖ выше предупредительного порога',
      all: [{ p: 'coolantTemp', op: '>', lim: 'coolantTemp.warn' }],
      causes: { COOLING_CLOGGED: 0.6, COOLANT_LOSS: 0.4 } },
    { id: 'R-COOL-02', title: 'Перегрев ДВС + видимая течь',
      all: [{ sym: 'OVERHEAT_ENGINE' }, { p: 'externalLeak', op: '==', value: true }],
      causes: { COOLANT_LOSS: 1.0 } },
    { id: 'R-COOL-04', title: 'Видимая утечка ОЖ',
      all: [{ sym: 'COOLANT_LEAK' }],
      causes: { COOLANT_LOSS: 1.0 } },
    { id: 'R-COOL-03', title: 'Критическая температура ОЖ',
      all: [{ p: 'coolantTemp', op: '>', lim: 'coolantTemp.crit' }],
      causes: { COOLING_CLOGGED: 0.3, COOLANT_LOSS: 0.3 },
      critical: 'Температура ОЖ выше критической — риск разрушения ДВС' },

    // --- Гидравлика ---
    { id: 'R-HYD-01', title: 'Утечка + падение давления в гидросистеме',
      all: [{ sym: 'HYDRAULIC_LEAK' }, { p: 'hydraulicPressure', op: '<', lim: 'hydraulicPressure.min' }],
      causes: { RVD_LEAK: 1.2 } },
    { id: 'R-HYD-02', title: 'Подтверждённая видимая течь РВД',
      all: [{ sym: 'HYDRAULIC_LEAK' }, { p: 'externalLeak', op: '==', value: true }],
      causes: { RVD_LEAK: 1.0 } },
    { id: 'R-HYD-03', title: 'Медленные движения + разбаланс насосов',
      all: [{ sym: 'SLOW_WORK_EQUIPMENT' }, { p: 'pumpPressureDelta', op: '>', lim: 'pumpPressureDelta.max' }],
      causes: { PUMP_WEAR: 1.2 } },
    { id: 'R-HYD-04', title: 'Медленные движения + пена в масле',
      all: [{ sym: 'SLOW_WORK_EQUIPMENT' }, { p: 'oilFoaming', op: '==', value: true }],
      causes: { AIR_SUCTION: 1.2 } },
    { id: 'R-HYD-05', title: 'Медленные движения рабочего оборудования',
      all: [{ sym: 'SLOW_WORK_EQUIPMENT' }],
      causes: { PUMP_WEAR: 0.35, AIR_SUCTION: 0.3, VALVE_WEAR: 0.3, HYD_FILTER: 0.15 } },
    { id: 'R-HYD-06', title: 'Медленные движения + пониженное давление',
      all: [{ sym: 'SLOW_WORK_EQUIPMENT' }, { p: 'hydraulicPressure', op: '<', lim: 'hydraulicPressure.min' }],
      causes: { PUMP_WEAR: 0.4, VALVE_WEAR: 0.4 } },
    { id: 'R-HYD-07', title: 'Рывки при совмещении операций',
      all: [{ sym: 'JERKS_COMBINED' }],
      causes: { PUMP_WEAR: 0.3, HYD_FILTER: 0.5 } },
    { id: 'R-HYD-08', title: 'Самопроизвольное опускание стрелы',
      all: [{ sym: 'BOOM_DRIFT' }],
      causes: { VALVE_WEAR: 1.0 },
      critical: 'Самопроизвольное опускание стрелы — опасность для персонала в зоне работ' },
    { id: 'R-HYD-09', title: 'Перегрев гидравлики',
      any: [{ sym: 'OVERHEAT_HYDRAULIC' }, { p: 'hydraulicOilTemp', op: '>', lim: 'hydraulicOilTemp.warn' }],
      causes: { HYD_FILTER: 0.5, PUMP_WEAR: 0.4, COOLING_CLOGGED: 0.3 } },

    // --- Тормоза (критично по ФНП) ---
    { id: 'R-BRK-01', title: 'Жалоба на эффективность торможения',
      all: [{ sym: 'BRAKE_WEAK' }],
      causes: { BRAKE_SEALS: 0.8 },
      critical: 'Неисправность тормозной системы — эксплуатация запрещена до устранения' },
    { id: 'R-BRK-02', title: 'Давление в контуре СТС ниже минимального',
      all: [{ p: 'brakePressure', op: '<', lim: 'brakePressure.min' }],
      causes: { BRAKE_SEALS: 1.2 },
      critical: 'Давление в контуре СТС ниже допустимого' },

    // --- КГШ ---
    { id: 'R-TIRE-01', title: 'Давление в шине ниже нормы',
      all: [{ p: 'tirePressure', op: '<', lim: 'tirePressure.min' }],
      causes: { TIRE_VALVE: 0.6, TIRE_DAMAGE: 0.4 } },
    { id: 'R-TIRE-02', title: 'Давление в шине ниже критического',
      all: [{ p: 'tirePressure', op: '<', lim: 'tirePressure.crit' }],
      causes: { TIRE_DAMAGE: 1.0 },
      critical: 'Критически низкое давление в КГШ — риск разрушения шины' },

    // --- Электрооборудование / тяговый привод ---
    { id: 'R-EL-01', title: 'Срабатывание защиты + низкое сопротивление изоляции',
      all: [{ sym: 'PROTECTION_TRIP' }, { p: 'insulationResistance', op: '<', lim: 'insulationResistance.min' }],
      causes: { INSULATION: 1.3 } },
    { id: 'R-EL-02', title: 'Срабатывание защиты + перегрев инвертора',
      all: [{ sym: 'PROTECTION_TRIP' }, { p: 'tractionInverterTemp', op: '>', lim: 'tractionInverterTemp.warn' }],
      causes: { TRACTION_OVERHEAT: 1.1, IGBT: 0.3 } },
    { id: 'R-EL-03', title: 'Срабатывание защиты + код неисправности инвертора',
      all: [{ sym: 'PROTECTION_TRIP' }, { p: 'faultCode', op: 'startsWith', value: 'INV' }],
      causes: { IGBT: 1.3 } },
    { id: 'R-EL-04', title: 'Срабатывание защиты (без уточняющих данных)',
      all: [{ sym: 'PROTECTION_TRIP' }],
      causes: { INSULATION: 0.2, IGBT: 0.2, TRACTION_OVERHEAT: 0.2, SENSOR: 0.2 } },
    { id: 'R-EL-05', title: '«Не тянет» + перегрев инвертора',
      all: [{ sym: 'POWER_LOSS' }, { p: 'tractionInverterTemp', op: '>', lim: 'tractionInverterTemp.warn' }],
      causes: { TRACTION_OVERHEAT: 1.2 } },

    // --- Безусловно критичные ---
    { id: 'R-STR-01', title: 'Трещина металлоконструкции',
      all: [{ sym: 'CRACK' }],
      causes: { STRUCTURE_CRACK: 1.5 },
      critical: 'Трещина несущей металлоконструкции — требуется УЗК-контроль и решение ответственного лица' },
    { id: 'R-STR-02', title: 'Люфт / тугое рулевое управление',
      all: [{ sym: 'STEERING_PLAY' }],
      causes: { STEERING: 1.5 },
      critical: 'Неисправность рулевого управления — эксплуатация запрещена до устранения' },
  ],
};
