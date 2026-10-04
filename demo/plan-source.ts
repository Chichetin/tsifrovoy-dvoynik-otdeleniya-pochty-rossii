/**
 * E01: the branch itself — room, zones and equipment of our own demo office.
 *
 * Everything here is invented. The office does not exist, the inventory numbers
 * are made up, and no name, phone or staff number of a real person appears in
 * the file: the brief allows synthetic data only, and a BTI plan or the HTML
 * example of the organizers must never leak into our submission.
 *
 * The numbers are metres of the model (Y up, the contract's convention), the
 * position is the centre of the object and `size_m` is [along X, along Y].
 * Sizes, heights and attributes are not written here: they come from
 * data/catalog/*.json through `objectOf`, so a catalog edit reaches the demo
 * plan without touching this table.
 */

import type { Attributes, Point, Polygon } from '../src/contracts/model';

/** Ceiling of the whole office, in metres. */
export const CEILING_M = 3;

/** Thickness of every wall of the demo, in metres. */
export const WALL_M = 0.25;

/**
 * The room is L-shaped on purpose: a rectangle would never show that areas are
 * computed from a polygon rather than from width × height.
 */
export const ROOM_BOUNDARY: Polygon = [
  [0, 0],
  [15, 0],
  [15, 10],
  [6, 10],
  [6, 7],
  [0, 7],
];

export type WallSource = { id: string; from: Point; to: Point };

/** Six outer walls plus three partitions. */
export const WALLS: WallSource[] = [
  { id: 'w_south', from: [0, 0], to: [15, 0] },
  { id: 'w_east', from: [15, 0], to: [15, 10] },
  { id: 'w_north', from: [15, 10], to: [6, 10] },
  { id: 'w_notch_east', from: [6, 10], to: [6, 7] },
  { id: 'w_notch_south', from: [6, 7], to: [0, 7] },
  { id: 'w_west', from: [0, 7], to: [0, 0] },
  { id: 'w_hall_back', from: [9.3, 0], to: [9.3, 7] },
  { id: 'w_staff', from: [6, 7], to: [9.3, 7] },
  { id: 'w_storage', from: [9.3, 6.2], to: [15, 6.2] },
];

export type OpeningSource = {
  id: string;
  wallId: string;
  offset_m: number;
  width_m: number;
  kind: 'entrance' | 'door' | 'window';
  sill_m: number;
  height_m: number;
};

/**
 * One entrance: the ≤ 3 m rule for the queue terminal is measured from the
 * centre of exactly this opening.
 */
export const OPENINGS: OpeningSource[] = [
  { id: 'op_entrance', wallId: 'w_south', offset_m: 6.3, width_m: 1.6, kind: 'entrance', sill_m: 0, height_m: 2.1 },
  { id: 'op_window_south', wallId: 'w_south', offset_m: 1.5, width_m: 2, kind: 'window', sill_m: 0.9, height_m: 1.5 },
  { id: 'op_window_east', wallId: 'w_east', offset_m: 2, width_m: 1.4, kind: 'window', sill_m: 0.9, height_m: 1.5 },
  // Keep the door below the storage partition's footprint (junction at y=6.2).
  { id: 'op_door_back', wallId: 'w_hall_back', offset_m: 5.15, width_m: 0.9, kind: 'door', sill_m: 0, height_m: 2.1 },
  { id: 'op_door_staff', wallId: 'w_staff', offset_m: 1.2, width_m: 0.9, kind: 'door', sill_m: 0, height_m: 2.1 },
  { id: 'op_door_storage', wallId: 'w_storage', offset_m: 3, width_m: 0.9, kind: 'door', sill_m: 0, height_m: 2.1 },
];

export type ZoneSource = {
  id: string;
  typeId: string;
  name: string;
  polygon: Polygon;
  parentId: string | null;
  attributes: Attributes;
};

/**
 * Eight zones, three of them nested in the client hall. Nesting is what keeps
 * the areas honest: the waiting and queue areas are parts of the hall, so a
 * flat sum of all zones would count their floor twice (D-011).
 *
 * `loadPercent`, `staffCount`, `queueLength` and `seatsPlanned` are synthetic
 * numbers typed in by hand for the informational layers. Nothing measures them.
 */
export const ZONES: ZoneSource[] = [
  {
    id: 'z_client',
    typeId: 'zt_client',
    name: 'Клиентский зал',
    polygon: [
      [0, 0],
      [9, 0],
      [9, 7],
      [0, 7],
    ],
    parentId: null,
    attributes: { publicAccess: true, loadPercent: 65, staffCount: 3 },
  },
  {
    id: 'z_entrance',
    typeId: 'zt_entrance',
    name: 'Входная группа',
    polygon: [
      [5.2, 0],
      [9, 0],
      [9, 2.4],
      [5.2, 2.4],
    ],
    parentId: 'z_client',
    attributes: { loadPercent: 40, staffCount: 0 },
  },
  {
    id: 'z_waiting',
    typeId: 'zt_waiting',
    name: 'Зона ожидания',
    polygon: [
      [0.2, 0.3],
      [4.8, 0.3],
      [4.8, 3.4],
      [0.2, 3.4],
    ],
    parentId: 'z_client',
    attributes: { seatsPlanned: 6, loadPercent: 55, staffCount: 0, queueLength: 4 },
  },
  {
    id: 'z_queue',
    typeId: 'zt_queue',
    name: 'Зона очереди',
    polygon: [
      [5, 2.6],
      [8.8, 2.6],
      [8.8, 4.6],
      [5, 4.6],
    ],
    parentId: 'z_client',
    attributes: { loadPercent: 70, staffCount: 0, queueLength: 7 },
  },
  {
    id: 'z_back',
    typeId: 'zt_service',
    name: 'Служебная зона',
    polygon: [
      [9.6, 0],
      [15, 0],
      [15, 6.2],
      [9.6, 6.2],
    ],
    parentId: null,
    attributes: { publicAccess: false, loadPercent: 50, staffCount: 2 },
  },
  {
    id: 'z_storage',
    typeId: 'zt_storage',
    name: 'Хранение и посылки',
    polygon: [
      [9.6, 6.2],
      [15, 6.2],
      [15, 8.6],
      [9.6, 8.6],
    ],
    parentId: null,
    attributes: { loadPercent: 45, staffCount: 1 },
  },
  {
    id: 'z_utility',
    typeId: 'zt_utility',
    name: 'Инженерное помещение',
    polygon: [
      [9.6, 8.6],
      [15, 8.6],
      [15, 10],
      [9.6, 10],
    ],
    parentId: null,
    attributes: { loadPercent: 20, staffCount: 0 },
  },
  {
    id: 'z_staff',
    typeId: 'zt_staff',
    name: 'Комната персонала',
    polygon: [
      [6.2, 7.2],
      [9, 7.2],
      [9, 10],
      [6.2, 10],
    ],
    parentId: null,
    attributes: { loadPercent: 30, staffCount: 1 },
  },
];

export type ObjectSource = {
  id: string;
  typeId: string;
  label: string;
  position: Point;
  rotation_deg: number;
  attributes: Attributes;
};

/**
 * Equipment of the demo, in the order a person would place it: the entrance
 * first, then the hall, then the back office, the storage, the plant room and
 * the staff room. Ids run without gaps from `eq_1`, so the editor gives the
 * next placed object the next number — that is what lets the browser test
 * reproduce `after.json` exactly.
 *
 * Three of these placements are wrong on purpose, and the assistant is expected
 * to find all three:
 *   - `eq_1` — the queue terminal stands 6.6 m from the entrance while the
 *     organizers' list allows 3 m (an error, not our assumption);
 *   - the waiting area has one bench where our own rule asks for two;
 *   - the client hall carries two information displays where our own rule
 *     allows one.
 */
export const OBJECTS: ObjectSource[] = [
  // Входная группа.
  { id: 'eq_1', typeId: 'ot_queue_terminal', label: 'Терминал электронной очереди', position: [1.2, 3], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-001' } },
  { id: 'eq_2', typeId: 'ot_info_stand', label: 'Стенд навигации по услугам', position: [5.8, 0.45], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-002' } },
  { id: 'eq_3', typeId: 'ot_mailbox', label: 'Ящик для писем', position: [8.6, 0.45], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-003' } },
  { id: 'eq_4', typeId: 'ot_payment_terminal', label: 'Терминал оплаты у входа', position: [8.5, 1.7], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-004' } },
  { id: 'eq_5', typeId: 'ot_media_panel', label: 'Медиапанель у входа', position: [8.45, 0.25], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-005', diagonalInch: 43 } },

  // Зона ожидания и зона очереди.
  { id: 'eq_6', typeId: 'ot_bench', label: 'Скамья ожидания 1', position: [2.2, 0.75], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-006', seats: 3 } },
  { id: 'eq_7', typeId: 'ot_info_display', label: 'Табло над зоной ожидания', position: [2.4, 3.3], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-007', diagonalInch: 55 } },
  { id: 'eq_8', typeId: 'ot_info_display', label: 'Табло над зоной очереди', position: [7, 4.5], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-008', diagonalInch: 55 } },
  { id: 'eq_9', typeId: 'ot_bench', label: 'Скамья у зоны очереди', position: [6, 3], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-009', seats: 3 } },

  // Линия обслуживания клиентского зала.
  { id: 'eq_10', typeId: 'ot_cashier_window', label: 'Окно 1 — приём и выдача', position: [1.5, 5.2], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-010', windowNumber: 1 } },
  { id: 'eq_11', typeId: 'ot_cashier_window', label: 'Окно 2 — платежи', position: [3.5, 5.2], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-011', windowNumber: 2 } },
  { id: 'eq_12', typeId: 'ot_cashier_window', label: 'Окно 3 — универсальное', position: [5.5, 5.2], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-012', windowNumber: 3 } },
  { id: 'eq_13', typeId: 'ot_workplace', label: 'Рабочее место оператора 1', position: [1.5, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-013', seatNumber: 1, hasLegRecess: true } },
  { id: 'eq_14', typeId: 'ot_workplace', label: 'Рабочее место оператора 2', position: [3.5, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-014', seatNumber: 2, hasLegRecess: true } },
  { id: 'eq_15', typeId: 'ot_workplace', label: 'Рабочее место оператора 3', position: [5.5, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-015', seatNumber: 3, hasLegRecess: false } },
  { id: 'eq_16', typeId: 'ot_computer', label: 'Компьютер оператора 1', position: [1.5, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-016' } },
  { id: 'eq_17', typeId: 'ot_computer', label: 'Компьютер оператора 2', position: [3.5, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-017' } },
  { id: 'eq_18', typeId: 'ot_computer', label: 'Компьютер оператора 3', position: [5.5, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-018' } },
  { id: 'eq_19', typeId: 'ot_pos_terminal', label: 'Кассовый терминал окна 1', position: [1.9, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-019' } },
  { id: 'eq_20', typeId: 'ot_pos_terminal', label: 'Кассовый терминал окна 2', position: [3.9, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-020' } },
  { id: 'eq_21', typeId: 'ot_pos_terminal', label: 'Кассовый терминал окна 3', position: [5.9, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-021' } },
  { id: 'eq_22', typeId: 'ot_scales', label: 'Весы на линии обслуживания', position: [1.05, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-022', maxWeightKg: 30 } },
  { id: 'eq_23', typeId: 'ot_label_printer', label: 'Принтер этикеток окна 2', position: [3.05, 6.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-023' } },
  { id: 'eq_24', typeId: 'ot_socket', label: 'Розетка RJ-45 клиентского зала', position: [0.35, 4], rotation_deg: 90, attributes: { inventoryNumber: 'ИНВ-ДЕМО-024', kind: 'RJ-45' } },
  { id: 'eq_25', typeId: 'ot_camera', label: 'Камера зала (вход)', position: [8.7, 6.7], rotation_deg: 225, attributes: { inventoryNumber: 'ИНВ-ДЕМО-025', viewAngleDeg: 90, viewRangeM: 8 } },
  { id: 'eq_26', typeId: 'ot_camera', label: 'Камера зоны ожидания', position: [0.5, 0.5], rotation_deg: 45, attributes: { inventoryNumber: 'ИНВ-ДЕМО-026', viewAngleDeg: 100, viewRangeM: 6 } },
  { id: 'eq_27', typeId: 'ot_fire_sensor', label: 'Датчик пожарной сигнализации зала', position: [4.5, 4.5], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-027' } },

  // Служебная зона.
  { id: 'eq_28', typeId: 'ot_workplace', label: 'Рабочее место сортировки', position: [10.2, 1.2], rotation_deg: 90, attributes: { inventoryNumber: 'ИНВ-ДЕМО-028', seatNumber: 4, hasLegRecess: false } },
  { id: 'eq_29', typeId: 'ot_workplace', label: 'Рабочее место начальника смены', position: [10.2, 3], rotation_deg: 90, attributes: { inventoryNumber: 'ИНВ-ДЕМО-029', seatNumber: 5, hasLegRecess: true } },
  { id: 'eq_30', typeId: 'ot_chair', label: 'Кресло сортировки', position: [11.2, 1.2], rotation_deg: 270, attributes: { inventoryNumber: 'ИНВ-ДЕМО-030' } },
  { id: 'eq_31', typeId: 'ot_chair', label: 'Кресло начальника смены', position: [11.2, 3], rotation_deg: 270, attributes: { inventoryNumber: 'ИНВ-ДЕМО-031' } },
  { id: 'eq_32', typeId: 'ot_computer', label: 'Компьютер сортировки', position: [10.2, 1.2], rotation_deg: 90, attributes: { inventoryNumber: 'ИНВ-ДЕМО-032' } },
  { id: 'eq_33', typeId: 'ot_printer', label: 'МФУ служебной зоны', position: [10.2, 3], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-033', isColor: false } },
  { id: 'eq_34', typeId: 'ot_scales', label: 'Весы приёма посылок', position: [10.2, 0.75], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-034', maxWeightKg: 50 } },
  { id: 'eq_35', typeId: 'ot_parcel_rack', label: 'Стеллаж приёма посылок', position: [13, 0.5], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-035', shelves: 5 } },
  { id: 'eq_36', typeId: 'ot_goods_rack', label: 'Стеллаж товаров служебной зоны', position: [11.6, 5.8], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-036', shelves: 4 } },
  { id: 'eq_37', typeId: 'ot_switchboard', label: 'Электрощит служебной зоны', position: [14.5, 5], rotation_deg: 270, attributes: { inventoryNumber: 'ИНВ-ДЕМО-037' } },
  { id: 'eq_38', typeId: 'ot_alarm_panel', label: 'Панель охранной сигнализации', position: [9.8, 0.6], rotation_deg: 90, attributes: { inventoryNumber: 'ИНВ-ДЕМО-038' } },
  { id: 'eq_39', typeId: 'ot_camera', label: 'Камера служебной зоны', position: [14.5, 0.4], rotation_deg: 315, attributes: { inventoryNumber: 'ИНВ-ДЕМО-039', viewAngleDeg: 90, viewRangeM: 7 } },
  { id: 'eq_40', typeId: 'ot_fire_sensor', label: 'Датчик пожарной сигнализации служебной зоны', position: [12, 3], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-040' } },

  // Хранение и посылки.
  { id: 'eq_41', typeId: 'ot_parcel_rack', label: 'Стеллаж посылок 1', position: [10.3, 6.7], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-041', shelves: 5 } },
  { id: 'eq_42', typeId: 'ot_parcel_rack', label: 'Стеллаж посылок 2', position: [11.6, 6.7], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-042', shelves: 5 } },
  { id: 'eq_43', typeId: 'ot_parcel_rack', label: 'Стеллаж посылок 3', position: [13.8, 6.7], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-043', shelves: 5 } },
  { id: 'eq_44', typeId: 'ot_goods_rack', label: 'Стеллаж хранения бланков', position: [10.5, 8.2], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-044', shelves: 4 } },
  { id: 'eq_45', typeId: 'ot_camera', label: 'Камера хранения', position: [14.6, 8.4], rotation_deg: 270, attributes: { inventoryNumber: 'ИНВ-ДЕМО-045', viewAngleDeg: 90, viewRangeM: 6 } },
  { id: 'eq_46', typeId: 'ot_fire_sensor', label: 'Датчик пожарной сигнализации хранения', position: [12, 7.4], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-046' } },

  // Инженерное помещение.
  { id: 'eq_47', typeId: 'ot_hvac', label: 'Вентиляционная установка', position: [12, 9.5], rotation_deg: 180, attributes: { inventoryNumber: 'ИНВ-ДЕМО-047' } },
  { id: 'eq_48', typeId: 'ot_water_heater', label: 'Водонагреватель', position: [10.4, 9.5], rotation_deg: 180, attributes: { inventoryNumber: 'ИНВ-ДЕМО-048' } },
  { id: 'eq_49', typeId: 'ot_switchboard', label: 'Вводной электрощит', position: [14.4, 9.4], rotation_deg: 270, attributes: { inventoryNumber: 'ИНВ-ДЕМО-049' } },

  // Комната персонала.
  { id: 'eq_50', typeId: 'ot_bench', label: 'Диван комнаты персонала', position: [7.5, 9.5], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-050', seats: 3 } },
  { id: 'eq_51', typeId: 'ot_chair', label: 'Кресло комнаты персонала', position: [6.7, 7.8], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-051' } },
  { id: 'eq_52', typeId: 'ot_water_heater', label: 'Водонагреватель комнаты персонала', position: [8.7, 7.5], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-052' } },
  { id: 'eq_53', typeId: 'ot_fire_sensor', label: 'Датчик пожарной сигнализации комнаты персонала', position: [7.6, 8.6], rotation_deg: 0, attributes: { inventoryNumber: 'ИНВ-ДЕМО-053' } },
];
