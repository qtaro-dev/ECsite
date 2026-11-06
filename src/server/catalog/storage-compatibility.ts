import type { StorageCompatibility } from '../../lib/schemas';
import type { CompatibilityProduct } from './compatibility';

function readPortCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readPower(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function connectionFor(specs: CompatibilityProduct['specs']): { port: 'sata' | 'm2' | null; protocol: 'SATA' | 'PCIe' | null } {
  const shape = typeof specs.form_factor === 'string' ? specs.form_factor.normalize('NFKC').trim() : '';
  const type = typeof specs.interface === 'string' ? specs.interface.normalize('NFKC').trim() : '';
  const sata = /^(?:sata|serial ata)(?:\b|(?=\d))/i.test(type);
  if (/^m\.2(?:\b|(?=\d))/i.test(shape)) {
    return { port: 'm2', protocol: sata ? 'SATA' : /^(?:pcie|nvme)(?:\b|(?=\d))/i.test(type) ? 'PCIe' : null };
  }
  if (sata && /^(?:2\.5|3\.5)(?:$|\s|インチ|["″])/i.test(shape)) return { port: 'sata', protocol: 'SATA' };
  return { port: null, protocol: null };
}

function evaluateHddPower(hdd: CompatibilityProduct | undefined, psu: CompatibilityProduct | undefined): StorageCompatibility['hddPower'] {
  if (!hdd) return null;
  const watts = readPower(hdd.specs.power_w);
  const rated = readPower(psu?.specs.rated_w);
  if (watts === null) return { watts, status: 'unknown', reason: 'HDDの消費電力が未登録のため確認できません。' };
  if (rated === null) return { watts, status: 'unknown', reason: '電源ユニットの定格出力が確認できません。' };
  if (watts > rated) return { watts, status: 'incompatible', reason: `HDD単体の消費電力が電源の定格出力 ${rated} W を上回っています。` };
  return { watts, status: 'unknown', reason: `HDD単体は電源の定格出力 ${rated} W 以下ですが、PC全体に必要な電力は確認できません。` };
}

export function evaluateStorageCompatibility(products: CompatibilityProduct[]): StorageCompatibility | undefined {
  const parts = products.filter(({ category }) => category === 'ssd' || category === 'hdd');
  if (!parts.length) return undefined;
  const connections = parts.map(({ specs }) => connectionFor(specs));
  const sataPortsRequired = connections.filter(({ port }) => port === 'sata').length;
  const m2SlotsRequired = connections.filter(({ port }) => port === 'm2').length;
  const unknownPortTypes = connections.some(({ port }) => port === null);
  const hddPower = evaluateHddPower(products.find(({ category }) => category === 'hdd'), products.find(({ category }) => category === 'power-supply'));
  const board = products.find(({ category }) => category === 'motherboard');
  const summary = { sataPortsRequired, m2SlotsRequired, unknownPortTypes, hddPower };
  if (!board) {
    const pending = { status: 'not_applicable' as const, reason: '比較するマザーボードを選択してください。' };
    return { ...summary, connection: pending, ports: pending };
  }

  const sataAvailable = readPortCount(board.specs.sata_port_count);
  const m2Available = readPortCount(board.specs.m2_slot_count);
  const protocols = Array.isArray(board.specs.m2_protocols) ? board.specs.m2_protocols : null;
  const unsupportedM2 = connections.find(({ port, protocol }) => port === 'm2' && protocol !== null && protocols !== null && !protocols.includes(protocol));
  const cannotConnect = (sataPortsRequired > 0 && sataAvailable === 0) || (m2SlotsRequired > 0 && m2Available === 0) || unsupportedM2;
  const connectionUnknown = connections.some(({ protocol }) => protocol === null)
    || (sataPortsRequired > 0 && sataAvailable === null)
    || (m2SlotsRequired > 0 && protocols === null);
  const connection: StorageCompatibility['connection'] = cannotConnect
    ? { status: 'incompatible', reason: unsupportedM2 ? `マザーボードのM.2は ${unsupportedM2.protocol} に対応していません。` : 'マザーボードに必要な種類の接続口がありません。' }
    : connectionUnknown
      ? { status: 'unknown', reason: '接続規格やマザーボードの対応仕様が不足しているため確認できません。' }
      : { status: 'compatible', reason: '登録仕様上、ストレージの接続規格に対応しています。' };

  const shortages = [
    sataAvailable !== null && sataPortsRequired > sataAvailable ? `SATAポート（搭載 ${sataAvailable}）` : null,
    m2Available !== null && m2SlotsRequired > m2Available ? `M.2スロット（搭載 ${m2Available}）` : null,
  ].filter(Boolean);
  const portsUnknown = unknownPortTypes || (sataPortsRequired > 0 && sataAvailable === null) || (m2SlotsRequired > 0 && m2Available === null);
  const ports: StorageCompatibility['ports'] = shortages.length > 0
    ? { status: 'incompatible', reason: `${shortages.join('、')}が不足しています。` }
    : portsUnknown
      ? { status: 'unknown', reason: '接続方式またはマザーボードのポート数が未登録のため確認できません。' }
      : { status: 'compatible', reason: '登録仕様上、必要なポート数を満たしています。' };

  return { ...summary, connection, ports };
}
