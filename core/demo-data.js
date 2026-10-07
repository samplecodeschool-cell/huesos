// СИНТЕТИЧЕСКИЕ данные для демонстрации. Не являются данными предприятия.
// Бортовые номера, наработки и история дефектов сгенерированы вручную.

export const MACHINES = [
  { id: 'T-117', model: 'CAT 785D', engineHours: 41250, mileage: 512300, nextServiceAt: 41500, serviceType: 'ТО-2', location: 'Гор. +180, забой 3' },
  { id: 'T-208', model: 'БелАЗ 7513N', engineHours: 28740, mileage: 344900, nextServiceAt: 29000, serviceType: 'ТО-1', location: 'Восточный съезд' },
  { id: 'T-305', model: 'БелАЗ 7558N', engineHours: 19980, mileage: 251200, nextServiceAt: 20000, serviceType: 'ТО-2', location: 'ММО-2' },
  { id: 'T-412', model: 'Unit Rig MT3300AC', engineHours: 52110, mileage: 688400, nextServiceAt: 52500, serviceType: 'ТО-3', location: 'Отвал «Северный»' },
  { id: 'E-02', model: 'Liebherr R-980', engineHours: 33600, mileage: null, nextServiceAt: 34000, serviceType: 'ТО-2', location: 'Гор. +150, забой 1' },
  { id: 'L-01', model: 'CAT 993', engineHours: 21400, mileage: null, nextServiceAt: 21500, serviceType: 'ТО-1', location: 'Рудный склад' },
];

/** История подтверждённых дефектов (для поиска похожих случаев). */
export const HISTORY = [
  { id: 'H-001', machineId: 'T-117', model: 'CAT 785D', date: '2026-02-11', symptoms: ['POWER_LOSS', 'BLACK_SMOKE'], cause: 'AIR_FILTER', downtimeH: 1.1 },
  { id: 'H-002', machineId: 'T-117', model: 'CAT 785D', date: '2026-06-03', symptoms: ['HYDRAULIC_LEAK'], cause: 'RVD_LEAK', downtimeH: 3.4 },
  { id: 'H-003', machineId: 'T-208', model: 'БелАЗ 7513N', date: '2026-01-20', symptoms: ['PROTECTION_TRIP'], cause: 'INSULATION', downtimeH: 9.5 },
  { id: 'H-004', machineId: 'T-208', model: 'БелАЗ 7513N', date: '2026-04-14', symptoms: ['PROTECTION_TRIP', 'POWER_LOSS'], cause: 'TRACTION_OVERHEAT', downtimeH: 4.0 },
  { id: 'H-005', machineId: 'T-305', model: 'БелАЗ 7558N', date: '2026-03-02', symptoms: ['BRAKE_WEAK'], cause: 'BRAKE_SEALS', downtimeH: 14.2 },
  { id: 'H-006', machineId: 'T-412', model: 'Unit Rig MT3300AC', date: '2026-05-19', symptoms: ['OVERHEAT_HYDRAULIC'], cause: 'HYD_FILTER', downtimeH: 2.2 },
  { id: 'H-007', machineId: 'E-02', model: 'Liebherr R-980', date: '2025-12-08', symptoms: ['SLOW_WORK_EQUIPMENT', 'JERKS_COMBINED'], cause: 'AIR_SUCTION', downtimeH: 5.0 },
  { id: 'H-008', machineId: 'E-02', model: 'Liebherr R-980', date: '2026-07-21', symptoms: ['SLOW_WORK_EQUIPMENT'], cause: 'PUMP_WEAR', downtimeH: 31.0 },
  { id: 'H-009', machineId: 'L-01', model: 'CAT 993', date: '2026-08-09', symptoms: ['OVERHEAT_ENGINE'], cause: 'COOLING_CLOGGED', downtimeH: 3.1 },
  { id: 'H-010', machineId: 'T-305', model: 'БелАЗ 7558N', date: '2026-08-30', symptoms: ['TIRE_PRESSURE_LOW'], cause: 'TIRE_VALVE', downtimeH: 0.8 },
  { id: 'H-011', machineId: 'T-208', model: 'БелАЗ 7513N', date: '2026-09-12', symptoms: ['PROTECTION_TRIP'], cause: 'IGBT', downtimeH: 18.5 },
  { id: 'H-012', machineId: 'T-412', model: 'Unit Rig MT3300AC', date: '2026-09-25', symptoms: ['POWER_LOSS', 'BLACK_SMOKE'], cause: 'INJECTORS', downtimeH: 7.4 },
];

/** Четыре обязательных демонстрационных сценария (п. 5.6 ТЗ) + бонусный. */
export const SCENARIOS = [
  {
    id: 'S1', title: 'Однозначное отклонение',
    note: 'CAT 785D: потеря мощности и чёрный дым, разрежение на впуске выше предела → засорённость воздушного фильтра.',
    machineId: 'T-117',
    defect: { symptoms: ['POWER_LOSS', 'BLACK_SMOKE'], comment: 'Водитель: «не тянет на подъёме», дым при разгоне' },
    params: { coolantTemp: 91, hydraulicPressure: 17.2, tirePressure: 6.8, fuelRate: 182, ambientTemp: -31, intakeRestriction: 7.4 },
  },
  {
    id: 'S2', title: 'Несколько вероятных причин',
    note: 'Liebherr R-980: медленное движение рабочего оборудования, давление чуть ниже нормы — насос, распределитель или подсос воздуха.',
    machineId: 'E-02',
    defect: { symptoms: ['SLOW_WORK_EQUIPMENT'], comment: 'Машинист: медленный подъём стрелы под нагрузкой' },
    params: { coolantTemp: 88, hydraulicPressure: 28.9, ambientTemp: -27 },
    followUp: { oilFoaming: true }, // результат дополнительной проверки → снимает неопределённость
  },
  {
    id: 'S3', title: 'Недостаточно данных',
    note: 'БелАЗ 7513N: «срабатывание защиты», без кода и замеров — агент не гадает, а запрашивает конкретные измерения.',
    machineId: 'T-208',
    defect: { symptoms: ['PROTECTION_TRIP'], comment: 'Остановка на съезде, после перезапуска поехал' },
    params: { ambientTemp: -35 },
    followUp: { faultCode: 'INV-217', tractionInverterTemp: 64 },
  },
  {
    id: 'S4', title: 'Потенциально критическое состояние',
    note: 'БелАЗ 7558N: жалоба на торможение, давление в контуре СТС ниже минимума → запрет эксплуатации, решение — только ответственное лицо.',
    machineId: 'T-305',
    defect: { symptoms: ['BRAKE_WEAK'], comment: 'Увеличенный тормозной путь на спуске' },
    params: { coolantTemp: 86, tirePressure: 6.4, ambientTemp: -29, brakePressure: 10.8 },
  },
  {
    id: 'S5', title: 'Бонус: КГШ при морозе',
    note: 'Unit Rig: давление в шине ниже нормы, но выше критического — подкачка на ММО и контроль, история подсказывает вентиль.',
    machineId: 'T-412',
    defect: { symptoms: ['TIRE_PRESSURE_LOW'], comment: 'Датчик Wenco: падение давления, колесо 4' },
    params: { tirePressure: 5.6, ambientTemp: -38, coolantTemp: 89 },
  },
];
