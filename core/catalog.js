// Справочники диагностического ядра «ТОРО-Ассистент».
// ВНИМАНИЕ: пороговые значения — демонстрационные (синтетические). Перед пилотом
// заменяются значениями из регламентов производителей и стандартов предприятия (задача Дмитрия).

/** Классы техники и демонстрационные пороги параметров. */
export const PROFILES = {
  truck136: {
    title: 'Карьерный самосвал 136 т',
    limits: {
      coolantTemp: { warn: 98, crit: 105 },          // °C
      hydraulicOilTemp: { warn: 80, crit: 92 },      // °C
      hydraulicPressure: { min: 15.0, nom: 17.5 },   // МПа, система опрокидывания/рулевого
      tirePressure: { min: 6.0, nom: 6.9, crit: 5.2 }, // бар (холодная шина)
      brakePressure: { min: 13.0, crit: 10.0 },      // МПа, СТС
      intakeRestriction: { warn: 5.0, max: 6.2 },    // кПа, разрежение на впуске
      insulationResistance: { min: 1.0 },            // МОм, силовые цепи
      tractionInverterTemp: { warn: 70, crit: 85 },  // °C
    },
  },
  truck90: {
    title: 'Карьерный самосвал 90 т',
    limits: {
      coolantTemp: { warn: 98, crit: 105 },
      hydraulicOilTemp: { warn: 80, crit: 92 },
      hydraulicPressure: { min: 14.0, nom: 16.0 },
      tirePressure: { min: 5.8, nom: 6.5, crit: 5.0 },
      brakePressure: { min: 12.0, crit: 9.5 },
      intakeRestriction: { warn: 5.0, max: 6.2 },
      insulationResistance: { min: 1.0 },
      tractionInverterTemp: { warn: 70, crit: 85 },
    },
  },
  loader: {
    title: 'Фронтальный погрузчик',
    limits: {
      coolantTemp: { warn: 98, crit: 105 },
      hydraulicOilTemp: { warn: 82, crit: 95 },
      hydraulicPressure: { min: 28.0, nom: 31.0 },
      tirePressure: { min: 5.5, nom: 6.2, crit: 4.8 },
      brakePressure: { min: 11.0, crit: 9.0 },
      intakeRestriction: { warn: 5.0, max: 6.2 },
    },
  },
  excavator: {
    title: 'Гидравлический экскаватор',
    limits: {
      coolantTemp: { warn: 98, crit: 105 },
      hydraulicOilTemp: { warn: 82, crit: 95 },
      hydraulicPressure: { min: 30.0, nom: 33.0 },
      pumpPressureDelta: { max: 10 },               // % разбаланс давлений насосов
      intakeRestriction: { warn: 5.0, max: 6.2 },
    },
  },
};

/** Модели парка → класс профиля. Названия моделей — открытая информация. */
export const MODELS = {
  'CAT 785D': 'truck136',
  'Unit Rig MT3300AC': 'truck136',
  'БелАЗ 7513A': 'truck136',
  'БелАЗ 7513N': 'truck136',
  'БелАЗ 7558N': 'truck90',
  'LeTourneau L-1150': 'loader',
  'CAT 993': 'loader',
  'Liebherr R-976': 'excavator',
  'Liebherr R-980': 'excavator',
  'Sany R1250': 'excavator',
};

/** Параметры: подпись, единица, источник (Wenco — автоматически, MANUAL — замер). */
export const PARAMS = {
  engineHours: { label: 'Наработка ДВС', unit: 'м·ч', source: 'WENCO' },
  mileage: { label: 'Пробег', unit: 'км', source: 'WENCO' },
  fuelRate: { label: 'Расход топлива', unit: 'л/ч', source: 'WENCO' },
  coolantTemp: { label: 'Температура ОЖ', unit: '°C', source: 'WENCO' },
  hydraulicPressure: { label: 'Давление в гидросистеме', unit: 'МПа', source: 'WENCO' },
  tirePressure: { label: 'Давление в шинах (мин.)', unit: 'бар', source: 'WENCO' },
  ambientTemp: { label: 'Температура воздуха', unit: '°C', source: 'WENCO' },
  hydraulicOilTemp: { label: 'Температура гидромасла', unit: '°C', source: 'MANUAL' },
  intakeRestriction: { label: 'Разрежение на впуске', unit: 'кПа', source: 'MANUAL' },
  brakePressure: { label: 'Давление в контуре СТС', unit: 'МПа', source: 'MANUAL' },
  insulationResistance: { label: 'Сопротивление изоляции', unit: 'МОм', source: 'MANUAL' },
  tractionInverterTemp: { label: 'Температура инвертора', unit: '°C', source: 'MANUAL' },
  pumpPressureDelta: { label: 'Разбаланс давлений насосов', unit: '%', source: 'MANUAL' },
  oilFoaming: { label: 'Пена/воздух в гидромасле', unit: 'да/нет', source: 'MANUAL', bool: true },
  externalLeak: { label: 'Видимая течь', unit: 'да/нет', source: 'MANUAL', bool: true },
  faultCode: { label: 'Код неисправности бортовой системы', unit: '', source: 'MANUAL', text: true },
};

/** Симптомы, которые выбирает механик (крупные кнопки на экране дефекта). */
export const SYMPTOMS = {
  POWER_LOSS: 'Потеря мощности / «не тянет»',
  BLACK_SMOKE: 'Чёрный дым',
  OVERHEAT_ENGINE: 'Перегрев ДВС',
  OVERHEAT_HYDRAULIC: 'Перегрев гидравлики',
  HYDRAULIC_LEAK: 'Утечка гидромасла',
  SLOW_WORK_EQUIPMENT: 'Медленное движение рабочего оборудования',
  JERKS_COMBINED: 'Рывки при совмещении операций',
  BOOM_DRIFT: 'Самопроизвольное опускание стрелы',
  BRAKE_WEAK: 'Низкая эффективность торможения',
  TIRE_PRESSURE_LOW: 'Падение давления в шине',
  PROTECTION_TRIP: 'Срабатывание защиты / отказ хода',
  STEERING_PLAY: 'Люфт / тугое рулевое',
  COOLANT_LEAK: 'Утечка ОЖ',
  CRACK: 'Трещина металлоконструкции',
};

/** Проверки (дополнительные измерения) — что агент может запросить. */
export const CHECKS = {
  CHK_INTAKE: { title: 'Замер разрежения на впуске (индикатор/манометр)', param: 'intakeRestriction', minutes: 5, place: 'ММО' },
  CHK_OIL_TEMP: { title: 'Замер температуры гидромасла (пирометр)', param: 'hydraulicOilTemp', minutes: 3, place: 'ММО' },
  CHK_BRAKE: { title: 'Замер давления в контуре СТС', param: 'brakePressure', minutes: 15, place: 'ММО' },
  CHK_INSULATION: { title: 'Замер сопротивления изоляции силовых цепей (мегаомметр)', param: 'insulationResistance', minutes: 20, place: 'ПАРМ' },
  CHK_INVERTER_TEMP: { title: 'Считать температуру инвертора с бортового контроллера', param: 'tractionInverterTemp', minutes: 5, place: 'ММО' },
  CHK_FAULT_CODE: { title: 'Считать код неисправности с бортового контроллера / шкафа управления', param: 'faultCode', minutes: 5, place: 'ММО' },
  CHK_PUMP_BALANCE: { title: 'Сравнительный замер давлений главных насосов', param: 'pumpPressureDelta', minutes: 25, place: 'ПАРМ' },
  CHK_FOAM: { title: 'Осмотр масла в баке на пену / воздух', param: 'oilFoaming', minutes: 5, place: 'ММО' },
  CHK_LEAK: { title: 'Визуальный осмотр РВД и соединений на течь', param: 'externalLeak', minutes: 10, place: 'ММО' },
  CHK_HYD_PRESSURE: { title: 'Контрольный замер давления в гидросистеме', param: 'hydraulicPressure', minutes: 10, place: 'ММО' },
  CHK_TIRE: { title: 'Замер давления в шинах манометром', param: 'tirePressure', minutes: 5, place: 'ММО' },
};

/**
 * Каталог причин (группы неисправностей). action — типовое действие;
 * place — где устраняется; checks — проверки, подтверждающие/исключающие причину.
 */
export const CAUSES = {
  AIR_FILTER: { title: 'Засорённость воздушного фильтра (система впуска)', system: 'ДВС', action: 'Замена/продувка фильтрующих элементов', place: 'ММО', repairH: 0.5, checks: ['CHK_INTAKE'] },
  INJECTORS: { title: 'Неисправность форсунок / ТНВД', system: 'ДВС', action: 'Диагностика топливной аппаратуры', place: 'Цех', repairH: 6, checks: ['CHK_FAULT_CODE', 'CHK_INTAKE'] },
  COOLING_CLOGGED: { title: 'Загрязнение радиатора / систем охлаждения', system: 'Система охлаждения', action: 'Очистка радиаторов и охладителей', place: 'ПАРМ', repairH: 2, checks: ['CHK_INVERTER_TEMP'] },
  COOLANT_LOSS: { title: 'Утечка ОЖ / износ патрубков', system: 'Система охлаждения', action: 'Замена патрубков, долив ОЖ', place: 'ПАРМ', repairH: 1.5, checks: ['CHK_LEAK'] },
  RVD_LEAK: { title: 'Утечка гидромасла через РВД / соединения', system: 'Гидросистема', action: 'Замена РВД, долив масла', place: 'ПАРМ', repairH: 1.5, checks: ['CHK_LEAK', 'CHK_HYD_PRESSURE'] },
  PUMP_WEAR: { title: 'Износ главных гидронасосов', system: 'Гидросистема', action: 'Диагностика/замена насоса', place: 'Цех', repairH: 16, checks: ['CHK_PUMP_BALANCE', 'CHK_OIL_TEMP'] },
  AIR_SUCTION: { title: 'Подсос воздуха во всасывающей линии', system: 'Гидросистема', action: 'Подтяжка/замена всасывающих соединений', place: 'ПАРМ', repairH: 2, checks: ['CHK_FOAM'] },
  VALVE_WEAR: { title: 'Износ распределителей / золотников', system: 'Гидросистема', action: 'Ревизия распределителя', place: 'Цех', repairH: 10, checks: ['CHK_PUMP_BALANCE', 'CHK_HYD_PRESSURE'] },
  HYD_FILTER: { title: 'Засорение гидрофильтров', system: 'Гидросистема', action: 'Замена фильтров гидросистемы', place: 'ММО', repairH: 1, checks: ['CHK_OIL_TEMP', 'CHK_FOAM'] },
  BRAKE_SEALS: { title: 'Износ уплотнений цилиндров СТС / утечки в контуре', system: 'Тормозная система', action: 'Ремонт тормозного контура', place: 'Цех', repairH: 8, checks: ['CHK_BRAKE', 'CHK_LEAK'] },
  TIRE_DAMAGE: { title: 'Пробой / повреждение КГШ', system: 'КГШ', action: 'Замена колеса', place: 'Шиномонтаж', repairH: 3, checks: ['CHK_TIRE'] },
  TIRE_VALVE: { title: 'Негерметичность вентиля / борта КГШ', system: 'КГШ', action: 'Подкачка, замена вентиля', place: 'ММО', repairH: 0.5, checks: ['CHK_TIRE'] },
  INSULATION: { title: 'Перетирание изоляции электропроводки', system: 'Электрооборудование', action: 'Поиск и устранение пробоя изоляции', place: 'ПАРМ', repairH: 4, checks: ['CHK_INSULATION', 'CHK_FAULT_CODE'] },
  IGBT: { title: 'Отказ силовой электроники (IGBT-модули инвертора)', system: 'Тяговый привод', action: 'Замена модуля инвертора', place: 'Цех', repairH: 12, checks: ['CHK_FAULT_CODE', 'CHK_INVERTER_TEMP'] },
  TRACTION_OVERHEAT: { title: 'Перегрев тяговых двигателей / инверторов (загрязнение охлаждения)', system: 'Тяговый привод', action: 'Очистка фильтров и каналов охлаждения тягового привода', place: 'ПАРМ', repairH: 2, checks: ['CHK_INVERTER_TEMP', 'CHK_FAULT_CODE'] },
  SENSOR: { title: 'Ложное срабатывание датчика / цепи датчика', system: 'Электрооборудование', action: 'Проверка датчика и разъёмов', place: 'ММО', repairH: 1, checks: ['CHK_FAULT_CODE'] },
  STRUCTURE_CRACK: { title: 'Усталостная трещина металлоконструкции', system: 'Металлоконструкции', action: 'УЗК-контроль, ремонт сваркой по технологии', place: 'Цех', repairH: 24, checks: [] },
  STEERING: { title: 'Износ ШСЛ / ослабление крепления рулевого управления', system: 'Рулевое управление', action: 'Ремонт рулевого управления', place: 'Цех', repairH: 6, checks: [] },
};

/** Априорные «типовые неисправности» по моделям (по классификации из перечня типовых отказов). */
export const TYPICAL = {
  'CAT 785D': ['RVD_LEAK', 'AIR_FILTER', 'TIRE_DAMAGE', 'TIRE_VALVE'],
  'Unit Rig MT3300AC': ['PUMP_WEAR', 'RVD_LEAK', 'TIRE_DAMAGE', 'SENSOR', 'INJECTORS', 'STEERING'],
  'БелАЗ 7513A': ['RVD_LEAK', 'INJECTORS', 'TIRE_DAMAGE', 'SENSOR'],
  'БелАЗ 7513N': ['RVD_LEAK', 'COOLANT_LOSS', 'INSULATION', 'BRAKE_SEALS', 'TIRE_DAMAGE', 'IGBT', 'TRACTION_OVERHEAT', 'STRUCTURE_CRACK'],
  'БелАЗ 7558N': ['RVD_LEAK', 'COOLANT_LOSS', 'INSULATION', 'BRAKE_SEALS', 'TIRE_DAMAGE', 'IGBT', 'TRACTION_OVERHEAT', 'STRUCTURE_CRACK'],
  'LeTourneau L-1150': ['PUMP_WEAR', 'AIR_SUCTION', 'VALVE_WEAR', 'HYD_FILTER', 'RVD_LEAK', 'BRAKE_SEALS', 'STRUCTURE_CRACK', 'STEERING'],
  'CAT 993': ['COOLING_CLOGGED', 'INJECTORS', 'AIR_FILTER', 'PUMP_WEAR', 'VALVE_WEAR', 'RVD_LEAK'],
  'Liebherr R-976': ['PUMP_WEAR', 'AIR_SUCTION', 'VALVE_WEAR', 'HYD_FILTER', 'RVD_LEAK', 'STRUCTURE_CRACK'],
  'Liebherr R-980': ['PUMP_WEAR', 'AIR_SUCTION', 'VALVE_WEAR', 'HYD_FILTER', 'RVD_LEAK', 'STRUCTURE_CRACK'],
  'Sany R1250': ['COOLING_CLOGGED', 'AIR_FILTER', 'INJECTORS', 'PUMP_WEAR', 'AIR_SUCTION', 'VALVE_WEAR', 'HYD_FILTER', 'STRUCTURE_CRACK'],
};

/** Модели с электрическим тяговым приводом (для них применимы причины тягового привода). */
export const ELECTRIC_DRIVE = new Set(['Unit Rig MT3300AC', 'БелАЗ 7513N', 'БелАЗ 7558N']);
export const ELECTRIC_CAUSES = new Set(['IGBT', 'TRACTION_OVERHEAT']);

/** Физически правдоподобные диапазоны — значения вне них считаются ошибкой ввода. */
export const PHYSICAL_RANGES = {
  coolantTemp: [-60, 150], hydraulicOilTemp: [-60, 150], hydraulicPressure: [0, 60],
  tirePressure: [0, 12], brakePressure: [0, 30], intakeRestriction: [0, 20],
  insulationResistance: [0, 1000], tractionInverterTemp: [-60, 200], pumpPressureDelta: [0, 100],
  ambientTemp: [-65, 45], fuelRate: [0, 1000],
};
