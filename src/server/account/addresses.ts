import type { Address } from '@/lib/schemas';

export type AddressRow = {
  id: string;
  recipient_name: string;
  postal_code: string;
  prefecture_code: number;
  city: string;
  street: string;
  building: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export function toAddress(row: AddressRow): Address & { id: string; createdAt: string; updatedAt: string } {
  return {
    id: row.id,
    recipientName: row.recipient_name,
    postalCode: row.postal_code,
    prefectureCode: row.prefecture_code,
    city: row.city,
    street: row.street,
    building: row.building,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const ADDRESS_SELECT = 'id,recipient_name,postal_code,prefecture_code,city,street,building,is_default,created_at,updated_at';
