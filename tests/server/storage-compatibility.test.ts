import { describe, expect, it } from 'vitest';
import type { CompatibilityProduct } from '../../src/server/catalog/compatibility';
import { evaluateStorageCompatibility } from '../../src/server/catalog/storage-compatibility';

const part = (category: CompatibilityProduct['category'], specs: CompatibilityProduct['specs']): CompatibilityProduct => ({ id: category, category, specs });
const hdd = part('hdd', { interface: 'SATA', form_factor: '3.5インチ', power_w: 6.5 });
const sataSsd = part('ssd', { interface: 'SATA III', form_factor: '2.5 inch' });
const m2Ssd = part('ssd', { interface: 'PCIe 4.0 x4', form_factor: 'M.2 2280' });

describe('supplementary storage checks', () => {
  it('counts separate SATA drives together and reports a definite shortage', () => {
    const result = evaluateStorageCompatibility([part('motherboard', { sata_port_count: 1 }), sataSsd, hdd]);
    expect(result).toMatchObject({ sataPortsRequired: 2, m2SlotsRequired: 0, connection: { status: 'compatible' }, ports: { status: 'incompatible' } });
  });

  it('counts SATA and M.2 separately and distinguishes M.2 SATA from PCIe', () => {
    const board = part('motherboard', { sata_port_count: 1, m2_slot_count: 1, m2_protocols: ['PCIe'] });
    expect(evaluateStorageCompatibility([board, m2Ssd, hdd])).toMatchObject({
      sataPortsRequired: 1, m2SlotsRequired: 1, connection: { status: 'compatible' }, ports: { status: 'compatible' },
    });
    const m2Sata = part('ssd', { interface: 'SATA', form_factor: 'M.2 2280' });
    expect(evaluateStorageCompatibility([board, m2Sata, hdd])).toMatchObject({
      sataPortsRequired: 1, m2SlotsRequired: 1, connection: { status: 'incompatible' }, ports: { status: 'compatible' },
    });
  });

  it('distinguishes zero available ports from unknown specifications', () => {
    expect(evaluateStorageCompatibility([part('motherboard', { sata_port_count: 0 }), hdd])).toMatchObject({
      connection: { status: 'incompatible' }, ports: { status: 'incompatible' },
    });
    expect(evaluateStorageCompatibility([part('motherboard', { sata_port_count: null }), hdd])).toMatchObject({
      connection: { status: 'unknown' }, ports: { status: 'unknown' },
    });
    expect(evaluateStorageCompatibility([part('motherboard', { sata_port_count: 2 }), part('hdd', { interface: 'SATA' })])).toMatchObject({
      unknownPortTypes: true, connection: { status: 'unknown' }, ports: { status: 'unknown' },
    });
    expect(evaluateStorageCompatibility([hdd])?.connection.status).toBe('not_applicable');
    expect(evaluateStorageCompatibility([])).toBeUndefined();
  });

  it('only concludes power incompatibility when the HDD alone exceeds the PSU rating', () => {
    expect(evaluateStorageCompatibility([hdd, part('power-supply', { rated_w: 5 })])?.hddPower).toMatchObject({ watts: 6.5, status: 'incompatible' });
    expect(evaluateStorageCompatibility([hdd, part('power-supply', { rated_w: 500 })])?.hddPower).toMatchObject({ watts: 6.5, status: 'unknown' });
    expect(evaluateStorageCompatibility([part('hdd', {})])?.hddPower).toMatchObject({ watts: null, status: 'unknown' });
    expect(evaluateStorageCompatibility([m2Ssd])?.hddPower).toBeNull();
  });
});
