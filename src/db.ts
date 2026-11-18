import { MikroORM } from '@mikro-orm/postgresql';

let orm: MikroORM;
export async function database() {
  if (!orm) {
    orm = await MikroORM.init({
      driver: (await import('@mikro-orm/postgresql')).PostgreSqlDriver,
      clientUrl: process.env.DATABASE_URL ?? 'postgresql://wager:wager_local_only@localhost:5432/wagering',
      entities: [],
	discovery: { warnWhenNoEntities: false },
	allowGlobalContext: true,
    });
  }
  return orm;
}
export async function query<T = any>(sql: string, params: unknown[] = [], em?: any): Promise<T[]> {
  const db = em ?? (await database()).em;
  return db.getConnection().execute(sql, params);
}
