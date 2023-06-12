import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {juggler} from '@loopback/repository';
import {FeatureToggleDbName} from '@sourceloop/feature-toggle-service';

const config = {
  name: 'users',
  connector: 'postgresql',
  url: '',
  host: process.env.FEATURE_DB_HOST,
  port: process.env.FEATURE_DB_PORT,
  user: process.env.FEATURE_DB_USER,
  password: process.env.FEATURE_DB_PASSWORD,
  database: process.env.FEATURE_DB_DATABASE,
  schema: 'main',
};

@lifeCycleObserver('datasource')
export class FeatureToggleDbDataSource
  extends juggler.DataSource
  implements LifeCycleObserver
{
  static dataSourceName = FeatureToggleDbName;
  static readonly defaultConfig = config;

  constructor(
    @inject('datasources.config.feature', {optional: true})
    dsConfig: object = config,
  ) {
    super(dsConfig);
  }
}
