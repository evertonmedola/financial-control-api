import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

// Used by the `typeorm` CLI (migration:generate/run/revert) outside of Nest's
// DI container — loads the same .env file the app itself reads via
// @nestjs/config, so both paths agree on connection details.
config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
