import type { Pool } from 'mysql2/promise';

let pool: Pool | null = null;

export default async function getPool(): Promise<Pool> {
  if (!pool) {
    const mysql = await import('mysql2/promise');
    pool = mysql.createPool(process.env.DATABASE_URL!);
  }
  return pool;
}
